import { Router } from "express";
import rateLimit from "express-rate-limit";
import { patientsRepo, patientSupportRequestsRepo } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { logAudit, logAuditBestEffort } from "../lib/audit";
import {
  SUPPORT_ACK_MESSAGE,
  SUPPORT_SCHEMA_MESSAGE,
  assertSupportRateLimits,
  formatSupportRequest,
  hashRequesterIp,
  issueDiagnosticAccessCodeForSupport,
  issueTemporaryPortalPassword,
  parseSupportRequestBody,
  parseSupportStatus,
} from "../lib/patient-support";

const router = Router();

const supportSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait before submitting again." },
});

/**
 * Public Contact Support intake. Never reveals whether a patient/account exists.
 */
router.post("/portal/support-requests", supportSubmitLimiter, async (req, res): Promise<void> => {
  if (!(await patientSupportRequestsRepo.schemaReady())) {
    res.status(503).json({ error: SUPPORT_SCHEMA_MESSAGE });
    return;
  }

  const parsed = parseSupportRequestBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const ipHash = hashRequesterIp(req.ip);
  const limits = await assertSupportRateLimits({
    patientHisId: parsed.patientHisId,
    ipHash,
  });
  if (!limits.ok) {
    res.status(limits.status).json({ error: limits.error });
    return;
  }

  try {
    await patientSupportRequestsRepo.insertSupportRequest({
      category: parsed.category,
      patientHisId: parsed.patientHisId,
      lastName: parsed.lastName,
      contactEmail: parsed.contactEmail,
      details: parsed.details,
      requesterIpHash: ipHash,
    });
  } catch {
    res.status(500).json({ error: "Unable to submit support request." });
    return;
  }

  await logAuditBestEffort({
    action: "edit",
    req,
    details: `patient_support_request_submitted:${parsed.category}`,
  });

  res.status(202).json({ message: SUPPORT_ACK_MESSAGE });
});

router.get(
  "/admin/support-requests",
  requireAuth,
  requireRole("super_admin"),
  async (req, res): Promise<void> => {
    if (!(await patientSupportRequestsRepo.schemaReady())) {
      res.status(503).json({ error: SUPPORT_SCHEMA_MESSAGE });
      return;
    }
    const status = parseSupportStatus(req.query.status);
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const result = await patientSupportRequestsRepo.listSupportRequests({ status, page, limit });
    res.json({
      data: result.data.map(formatSupportRequest),
      total: result.total,
      page,
      limit,
    });
  },
);

router.post(
  "/admin/support-requests/:id/process",
  requireAuth,
  requireRole("super_admin"),
  async (req, res): Promise<void> => {
    if (!(await patientSupportRequestsRepo.schemaReady())) {
      res.status(503).json({ error: SUPPORT_SCHEMA_MESSAGE });
      return;
    }

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid request id." });
      return;
    }

    const action = typeof req.body?.action === "string" ? req.body.action.trim() : "";
    const adminNotes =
      typeof req.body?.adminNotes === "string" ? req.body.adminNotes.trim().slice(0, 500) : null;

    const existing = await patientSupportRequestsRepo.findSupportRequestById(id);
    if (!existing) {
      res.status(404).json({ error: "Support request not found." });
      return;
    }

    if (action === "reject") {
      if (existing.status === "completed" || existing.status === "rejected") {
        res.status(409).json({ error: "This support request has already been closed." });
        return;
      }
      // Reject only from pending (atomic) — processing means another admin owns the claim.
      if (existing.status !== "pending") {
        res.status(409).json({ error: "This support request is already being processed." });
        return;
      }
      const claimed = await patientSupportRequestsRepo.claimPendingSupportRequest({
        id,
        processedById: req.user!.userId,
      });
      if (!claimed) {
        res.status(409).json({ error: "This support request is already being processed or closed." });
        return;
      }
      const updated = await patientSupportRequestsRepo.updateSupportRequestIfProcessing(id, {
        status: "rejected",
        processedById: req.user!.userId,
        processedAt: new Date(),
        adminNotes,
      });
      await logAudit({
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        details: `patient_support_request_rejected:${existing.category}`,
      });
      res.json({ request: formatSupportRequest(updated ?? claimed) });
      return;
    }

    if (action !== "fulfill") {
      res.status(400).json({ error: "action must be fulfill or reject." });
      return;
    }

    if (existing.status === "completed" || existing.status === "rejected") {
      res.status(409).json({ error: "This support request has already been closed." });
      return;
    }
    if (existing.status === "processing") {
      res.status(409).json({ error: "This support request is already being processed." });
      return;
    }

    const patient = await patientsRepo.findPatientByHisId(existing.patientHisId);
    if (!patient || patient.lastName.toLowerCase() !== existing.lastName.toLowerCase()) {
      // Do not claim — verification failed before any credential work.
      res.status(400).json({
        error: "Could not verify a matching hospital patient for this request.",
      });
      return;
    }

    const claimed = await patientSupportRequestsRepo.claimPendingSupportRequest({
      id,
      processedById: req.user!.userId,
      matchedPatientId: patient.id,
    });
    if (!claimed) {
      res.status(409).json({ error: "This support request is already being processed or closed." });
      return;
    }

    if (existing.category === "temporary_password") {
      const issued = await issueTemporaryPortalPassword({
        patientId: patient.id,
        adminUserId: req.user!.userId,
      });
      if (!issued.ok) {
        // Credential was not issued — return to pending so another admin can retry after fixing the cause.
        await patientSupportRequestsRepo.updateSupportRequestIfProcessing(id, {
          status: "pending",
          matchedPatientId: patient.id,
          processedById: null,
          processedAt: null,
          adminNotes: issued.error.slice(0, 500),
        });
        res.status(issued.status).json({ error: issued.error });
        return;
      }

      // Password hash already changed — never reset to pending (would allow duplicate issuance).
      const updated = await patientSupportRequestsRepo.updateSupportRequestIfProcessing(id, {
        status: "completed",
        matchedPatientId: patient.id,
        processedById: req.user!.userId,
        processedAt: new Date(),
        adminNotes:
          adminNotes ??
          (issued.emailAccepted
            ? "Temporary password issued and email accepted for sending."
            : "Temporary password issued; email delivery failed."),
      });

      await logAudit({
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        patientHisId: patient.patientHisId,
        details: issued.emailAccepted
          ? "patient_support_temp_password_issued_and_emailed"
          : "patient_support_temp_password_issued_email_failed",
      });

      res.json({
        request: formatSupportRequest(updated ?? claimed),
        passwordReset: true,
        emailAccepted: issued.emailAccepted,
        emailedToMasked: issued.emailedToMasked,
        ...(issued.emailAccepted ? {} : { temporaryPassword: issued.temporaryPassword }),
        message: issued.emailAccepted
          ? "Temporary password issued and email accepted for sending."
          : "Temporary password was set, but email delivery failed. The one-time password is included for authorized handoff only.",
      });
      return;
    }

    // diagnostic_access_code — hash is not replaced until email is accepted.
    const issued = await issueDiagnosticAccessCodeForSupport({ patientId: patient.id });
    if (!issued.ok) {
      if (issued.activationUncertain || issued.deliveryUncertain) {
        // Uncertain delivery/activation — do not auto-reopen (avoids duplicate codes if email actually sent).
        await patientSupportRequestsRepo.updateSupportRequestIfProcessing(id, {
          status: "completed",
          matchedPatientId: patient.id,
          processedById: req.user!.userId,
          processedAt: new Date(),
          adminNotes: issued.error.slice(0, 500),
        });
        res.status(issued.status).json({
          error: issued.error,
          emailAccepted: issued.emailAccepted,
          credentialIssued: false,
          ...(issued.activationUncertain ? { activationUncertain: true } : {}),
          ...(issued.deliveryUncertain ? { deliveryUncertain: true } : {}),
        });
        return;
      }
      // Definitive pre-activation failure — safe to return to pending.
      await patientSupportRequestsRepo.updateSupportRequestIfProcessing(id, {
        status: "pending",
        matchedPatientId: patient.id,
        processedById: null,
        processedAt: null,
        adminNotes: issued.error.slice(0, 500),
      });
      res.status(issued.status).json({ error: issued.error });
      return;
    }

    const after = await patientsRepo.findPatientById(patient.id);
    if (patient.portalUserId == null && after?.portalUserId != null) {
      res.status(500).json({ error: "Unexpected portal account creation during access-code issue." });
      return;
    }

    const updated = await patientSupportRequestsRepo.updateSupportRequestIfProcessing(id, {
      status: "completed",
      matchedPatientId: patient.id,
      processedById: req.user!.userId,
      processedAt: new Date(),
      adminNotes: adminNotes ?? "Diagnostic access code issued and email accepted for sending.",
    });

    await logAudit({
      action: "access_code_regen",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      patientHisId: patient.patientHisId,
      details: "patient_support_access_code_issued_and_emailed",
    });

    res.json({
      request: formatSupportRequest(updated ?? claimed),
      accessCodeIssued: true,
      credentialIssued: true,
      emailAccepted: true,
      emailedToMasked: issued.emailedToMasked,
      message: "Access code issued and email accepted for sending.",
    });
  },
);

/** Reject staff recovery submissions; doctor recovery stays acknowledgement-only. */
router.post("/auth/account-recovery", supportSubmitLimiter, async (req, res): Promise<void> => {
  const role = typeof req.body?.role === "string" ? req.body.role.trim().toLowerCase() : "";
  if (role === "staff") {
    await logAuditBestEffort({
      action: "access_denied",
      req,
      details: "Unsupported staff account recovery attempt",
    });
    res.status(400).json({
      error: "Staff password recovery is not available here. Contact your system administrator.",
    });
    return;
  }
  if (role === "doctor") {
    res.status(202).json({
      message:
        "If these details match a physician account, the appropriate support team will process the request.",
    });
    return;
  }
  if (role === "patient") {
    res.status(400).json({
      error: "Use the Patient recovery flow on this page to reset a Patient Portal password.",
    });
    return;
  }
  res.status(400).json({ error: "Select Doctor or Patient." });
});

export default router;
