import { Router } from "express";
import fs from "fs";
import rateLimit from "express-rate-limit";
import {
  authSessionsRepo,
  hospitalPatientsRepo,
  notificationsRepo,
  patientsRepo,
  prescriptionsRepo,
  resultsRepo,
  schedulerAppointmentsRepo,
  usersRepo,
  type PrescriptionWithItems,
  type ResultRow,
  type SchedulerAppointmentRow,
} from "@workspace/db";
import { formatPatient, physicianName } from "../lib/formatters";
import { GetPortalResultDownloadUrlParams } from "@workspace/api-zod";
import { requirePortalAuth } from "../middlewares/auth";
import {
  signPortalToken,
  signDownloadToken,
  verifyToken,
  compareAccessCode,
  comparePassword,
  hashPassword,
  sessionRefreshCookieName,
  REFRESH_COOKIE_NAME,
} from "../lib/auth";
import { expireLegacyRefreshCookie, refreshCookieOptions } from "../lib/cookies";
import { issueAuthSession } from "../lib/issue-auth-session";
import { getFilePath } from "../lib/storage";
import { denyAccess, logAudit, logAuditBestEffort } from "../lib/audit";
import { canPortalAccessResult } from "../lib/result-access";
import { formatPrescription } from "../lib/format-prescription";
import { resolvePortalPatientForLogin } from "../lib/portal-registration";
import { resolveActivePortalAccount } from "../lib/portal-activation";
import {
  GENERIC_VERIFY_MESSAGE,
  HIS_UNAVAILABLE_MESSAGE,
  parseRegisterPortalAccountBody,
  parseVerifyIdentityBody,
  registerPortalAccount,
  verifyIdentityForRegistration,
} from "../lib/portal-his-verify";
import {
  ASSISTED_RECOVERY_MESSAGE,
  confirmPasswordRecovery,
  EMAIL_UNAVAILABLE_MESSAGE,
  PORTAL_PASSWORD_REQUIREMENTS_MSG,
  RECOVERY_REQUEST_MESSAGE,
  requestPasswordRecovery,
  verifyPasswordRecoveryOtp,
} from "../lib/portal-recovery";
import {
  formatPortalProfile,
  profileAuditDetails,
  resolvePortalProfilePatient,
  updatePortalProfileContact,
} from "../lib/portal-profile";
import {
  RESULTS_ACCESS_INVALID_ERROR,
  RESULTS_ACCESS_REQUIRED_ERROR,
  verifyPortalResultsAccessCode,
} from "../lib/portal-result-access";
import { isValidPortalPassword } from "../lib/portal-password-policy";
import {
  completeForcedPasswordChange,
  isForcedPasswordChangeRequired,
  isTemporaryPasswordExpired,
} from "../lib/patient-support";
import {
  buildPortalAppointmentsPayload,
  hospitalTodayIso,
} from "../lib/portal-appointments";
import {
  appointmentsSourceFromResult,
  buildCareHistoryEvents,
  CARE_HISTORY_SOURCE_LIMIT,
  type CareHistoryPayload,
  type CareHistorySources,
} from "../lib/portal-care-history";
import { logger } from "../lib/logger";

const router = Router();

const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later.", reason: "RATE_LIMITED" },
});

const identityVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later.", reason: "RATE_LIMITED" },
});

/**
 * Step 1: HIS identity verification only. Returns registration token for new accounts.
 */
router.post("/portal/verify-identity", identityVerifyLimiter, async (req, res): Promise<void> => {
  const parsed = parseVerifyIdentityBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: GENERIC_VERIFY_MESSAGE });
    return;
  }

  const result = await verifyIdentityForRegistration(parsed);

  if (!result.ok) {
    if (result.kind === "his_unavailable") {
      await logAuditBestEffort({
        action: "access_denied",
        req,
        details: JSON.stringify({
          source: "LiveDB_ACE",
          operation: "patient_identity_verification",
          result: "unavailable",
        }),
      });
      res.status(503).json({ error: HIS_UNAVAILABLE_MESSAGE });
      return;
    }
    await logAuditBestEffort({
      action: "access_denied",
      req,
      details: JSON.stringify({
        source: "LiveDB_ACE",
        operation: "patient_identity_verification",
        result: "failed",
      }),
    });
    res.status(401).json({ error: GENERIC_VERIFY_MESSAGE });
    return;
  }

  await logAuditBestEffort({
    action: "view",
    req,
    patientHisId: result.isNewPortalAccount ? result.hospital.patientHisId : undefined,
    details: JSON.stringify({
      source: "LiveDB_ACE",
      operation: "patient_identity_verification",
      result: "success",
      isNewPortalAccount: result.isNewPortalAccount,
    }),
  });

  if (result.isNewPortalAccount) {
    res.json({
      verified: true,
      isNewPortalAccount: true,
      registrationToken: result.registrationToken,
    });
    return;
  }

  if (result.needsPortalActivation === true && typeof result.registrationToken === "string") {
    res.json({
      verified: true,
      isNewPortalAccount: false,
      needsPortalActivation: true,
      registrationToken: result.registrationToken,
    });
    return;
  }

  res.json({
    verified: true,
    isNewPortalAccount: false,
  });
});

/**
 * Step 2: Create portal account after HIS verification (registration token + patient email).
 */
router.post("/portal/register", identityVerifyLimiter, async (req, res): Promise<void> => {
  const parsed = parseRegisterPortalAccountBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Invalid registration information." });
    return;
  }

  const result = await registerPortalAccount(parsed);

  if (!result.ok) {
    await logAuditBestEffort({
      action: "access_denied",
      req,
      details: JSON.stringify({
        source: "ACE_ResultsPortal",
        operation: "portal_account_registration",
        result: "failed",
        reason: result.kind,
      }),
    });

    if (result.kind === "email_taken") {
      res.status(409).json({ error: "That email address is not available." });
      return;
    }
    if (result.kind === "account_exists") {
      res.status(409).json({ error: "Your hospital record is already registered." });
      return;
    }
    if (result.kind === "invalid_token") {
      res.status(401).json({ error: "Registration verification has expired. Please verify your hospital record again." });
      return;
    }
    if (result.kind === "validation") {
      res.status(400).json({ error: PORTAL_PASSWORD_REQUIREMENTS_MSG });
      return;
    }
    res.status(503).json({ error: HIS_UNAVAILABLE_MESSAGE });
    return;
  }

  await logAudit({
    action: "edit",
    req,
    patientHisId: result.patient.patientHisId,
    details: JSON.stringify({
      source: "ACE_ResultsPortal",
      operation: "portal_account_registration",
      result: "success",
    }),
  });

  res.json({
    created: true,
    activated: result.activated === true,
    ...(typeof result.accessCode === "string" ? { accessCode: result.accessCode } : {}),
    patient: {
      id: result.patient.id,
      patientHisId: result.patient.patientHisId,
      firstName: result.patient.firstName,
      middleName: result.patient.middleName ?? null,
      lastName: result.patient.lastName,
      dateOfBirth: result.patient.dateOfBirth,
    },
  });
});

router.post("/portal/recover/request", identityVerifyLimiter, async (req, res): Promise<void> => {
  const result = await requestPasswordRecovery(req.body);

  if (!result.ok) {
    if (result.kind === "his_unavailable") {
      res.status(503).json({ error: HIS_UNAVAILABLE_MESSAGE });
      return;
    }
    if (result.kind === "email_unavailable") {
      res.status(503).json({ error: EMAIL_UNAVAILABLE_MESSAGE });
      return;
    }
    await logAuditBestEffort({
      action: "access_denied",
      req,
      details: JSON.stringify({
        source: "LiveDB_ACE",
        operation: "portal_password_recovery",
        result: "failed",
      }),
    });
    res.status(401).json({ error: GENERIC_VERIFY_MESSAGE });
    return;
  }

  await logAuditBestEffort({
    action: "view",
    req,
    details: JSON.stringify({
      source: "ACE_ResultsPortal",
      operation: "portal_password_recovery",
      result: "requested",
      kind: result.kind === "no_portal_account" ? "generic" : result.kind,
    }),
  });

  // Do not reveal whether a portal account exists for a verified HIS identity.
  if (result.kind === "no_portal_account") {
    res.json({ message: RECOVERY_REQUEST_MESSAGE });
    return;
  }

  if (result.kind === "assisted_recovery") {
    res.json({
      assistedRecovery: true,
      message: ASSISTED_RECOVERY_MESSAGE,
    });
    return;
  }

  res.json({
    recoveryToken: result.recoveryToken,
    maskedEmail: result.maskedEmail,
    message: "A verification code has been sent to your registered portal email.",
  });
});

router.post("/portal/recover/verify", identityVerifyLimiter, async (req, res): Promise<void> => {
  const result = verifyPasswordRecoveryOtp(req.body);
  if (!result.ok) {
    await logAuditBestEffort({
      action: "access_denied",
      req,
      details: JSON.stringify({
        source: "ACE_ResultsPortal",
        operation: "portal_password_recovery",
        result: "otp_failed",
        reason: result.kind,
      }),
    });
    if (result.kind === "invalid_token") {
      res.status(401).json({ error: "Recovery verification has expired. Please start again." });
      return;
    }
    res.status(401).json({ error: "Invalid verification code." });
    return;
  }
  res.json({ verified: true });
});

router.post("/portal/recover/confirm", identityVerifyLimiter, async (req, res): Promise<void> => {
  const result = await confirmPasswordRecovery(req.body);

  if (!result.ok) {
    await logAuditBestEffort({
      action: "access_denied",
      req,
      details: JSON.stringify({
        source: "ACE_ResultsPortal",
        operation: "portal_password_recovery",
        result: "confirm_failed",
        reason: result.kind,
      }),
    });

    if (result.kind === "email_unavailable") {
      res.status(503).json({ error: EMAIL_UNAVAILABLE_MESSAGE });
      return;
    }
    if (result.kind === "persist_failed") {
      res.status(500).json({
        error: "Unable to complete password recovery. Please try again or contact support.",
      });
      return;
    }
    if (result.kind === "invalid_token" || result.kind === "otp_required") {
      res.status(401).json({
        error: result.kind === "otp_required"
          ? "Enter the verification code from your email before setting a password."
          : "Recovery verification has expired. Please start again.",
      });
      return;
    }
    if (result.kind === "invalid_password") {
      res.status(400).json({ error: PORTAL_PASSWORD_REQUIREMENTS_MSG });
      return;
    }
    res.status(401).json({ error: "Invalid verification code." });
    return;
  }

  await logAudit({
    action: "edit",
    req,
    details: JSON.stringify({
      source: "ACE_ResultsPortal",
      operation: "portal_password_recovery",
      result: "success",
    }),
  });

  res.json({
    success: true,
    message: "Your password has been reset. You can now sign in with your new password.",
  });
});

/** Validates the diagnostic access code for viewing results. Requires a portal session. */
router.post("/portal/verify", requirePortalAuth, portalLimiter, async (req, res): Promise<void> => {
  const accessCode = typeof req.body?.accessCode === "string" ? req.body.accessCode.trim() : "";
  if (!accessCode || accessCode.length > 32) {
    res.status(400).json({ error: RESULTS_ACCESS_INVALID_ERROR });
    return;
  }

  const patient = await patientsRepo.findPatientById(req.portalUser!.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const portalAccount = await resolveActivePortalAccount(patient);
  if (!portalAccount.ok) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }

  if (!patient.accessCodeHash) {
    res.status(403).json({ error: RESULTS_ACCESS_INVALID_ERROR });
    return;
  }

  const codeOk = await compareAccessCode(accessCode, patient.accessCodeHash);
  if (!codeOk) {
    await logAuditBestEffort({
      action: "access_denied",
      req,
      patientHisId: patient.patientHisId,
      details: JSON.stringify({
        source: "ACE_ResultsPortal",
        operation: "portal_results_access",
        result: "failed",
      }),
    });
    res.status(401).json({ error: RESULTS_ACCESS_INVALID_ERROR });
    return;
  }

  await logAudit({
    action: "view",
    req,
    patientHisId: patient.patientHisId,
    details: JSON.stringify({
      source: "ACE_ResultsPortal",
      operation: "portal_results_access",
      result: "success",
    }),
  });

  res.json({ unlocked: true });
});

/** @deprecated Prefer POST /portal/verify after portal login for results access. */
router.post("/portal/results/unlock", requirePortalAuth, portalLimiter, async (req, res): Promise<void> => {
  const accessCode = typeof req.body?.accessCode === "string" ? req.body.accessCode.trim() : "";
  if (!accessCode || accessCode.length > 32) {
    res.status(400).json({ error: RESULTS_ACCESS_INVALID_ERROR });
    return;
  }

  const patient = await patientsRepo.findPatientById(req.portalUser!.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const codeOk = await compareAccessCode(accessCode, patient.accessCodeHash ?? "");
  if (!codeOk) {
    res.status(401).json({ error: RESULTS_ACCESS_INVALID_ERROR });
    return;
  }

  res.json({ unlocked: true });
});

/** Patient portal login — Hospital Patient ID (or username) + password. */
router.post("/portal/login", portalLimiter, async (req, res): Promise<void> => {
  const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";

  const deny = async () => {
    await logAuditBestEffort({ action: "access_denied", req, details: "Failed portal login" });
    res.status(401).json({ error: "Invalid credentials" });
  };

  if (!identifier || !password || !lastName) {
    await deny();
    return;
  }

  const resolved = await resolvePortalPatientForLogin(identifier);

  if (!resolved || resolved.portalUserId == null) {
    await deny();
    return;
  }

  const portalAccount = await resolveActivePortalAccount(resolved.patient);
  if (!portalAccount.ok) {
    await deny();
    return;
  }

  if (resolved.patient.lastName.toLowerCase() !== lastName.toLowerCase()) {
    await deny();
    return;
  }

  if (portalAccount.user.lockedUntil && portalAccount.user.lockedUntil > new Date()) {
    res.status(403).json({ error: "Account locked. Try again later." });
    return;
  }

  const valid = await comparePassword(password, resolved.passwordHash);
  if (!valid) {
    const attempts = (portalAccount.user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await usersRepo.recordFailedLogin(portalAccount.user.id, attempts, lockedUntil);
    await deny();
    return;
  }

  if (isTemporaryPasswordExpired(portalAccount.user)) {
    await deny();
    return;
  }

  await usersRepo.recordSuccessfulLogin(portalAccount.user.id);

  await logAudit({
    action: "login",
    req,
    userId: portalAccount.user.id,
    patientHisId: resolved.patient.patientHisId,
    details: "portal_login_succeeded",
  });

  const issued = await issueAuthSession({ userId: portalAccount.user.id, portal: "patient" });
  const sessionToken = signPortalToken({
    patientId: resolved.patient.id,
    patientHisId: resolved.patient.patientHisId,
    sid: issued.publicId,
  });

  const mustChangePassword = isForcedPasswordChangeRequired(portalAccount.user);

  expireLegacyRefreshCookie(res, req.cookies?.[REFRESH_COOKIE_NAME]);
  res.cookie(sessionRefreshCookieName(issued.publicId), issued.refreshSecret, refreshCookieOptions());
  res.json({
    sessionPublicId: issued.publicId,
    sessionToken,
    mustChangePassword,
    patient: {
      id: resolved.patient.id,
      patientHisId: resolved.patient.patientHisId,
      firstName: resolved.patient.firstName,
      lastName: resolved.patient.lastName,
      middleName: resolved.patient.middleName ?? null,
    },
  });
});

router.post("/portal/change-password", requirePortalAuth, portalLimiter, async (req, res): Promise<void> => {
  const portalUserId = req.portalUser?.userId;
  if (portalUserId == null) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current password and new password are required." });
    return;
  }

  const result = await completeForcedPasswordChange({
    portalUserId,
    currentPassword,
    newPassword,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  await logAudit({
    action: "edit",
    req,
    userId: portalUserId,
    patientHisId: req.portalUser!.patientHisId,
    details: "portal_forced_password_change_completed",
  });

  // Caller must sign in again; previous sessions were revoked.
  res.json({
    success: true,
    message: "Password updated. Sign in again with your new password.",
  });
});

const NOTIFICATIONS_SCHEMA_MSG =
  "Notifications schema is not installed. Run docs/migration/sql/007_create_notifications_messaging.sql against ACE_ResultsPortal.";

function formatPortalNotification(n: {
  id: number;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: number | null;
  priority: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    entityType: n.entityType,
    entityId: n.entityId,
    priority: n.priority,
    isRead: n.isRead,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    expiresAt: n.expiresAt ? n.expiresAt.toISOString() : null,
  };
}

/** Resolve authenticated portal JWT → patients.portal_user_id → users.id (active patient). */
async function resolvePortalNotificationRecipient(
  patientId: number,
  patientHisId: string,
): Promise<{ ok: true; recipientUserId: number } | { ok: false }> {
  const patient =
    (Number.isFinite(patientId) ? await patientsRepo.findPatientById(patientId) : undefined) ??
    (await patientsRepo.findPatientByHisId(patientHisId));
  if (!patient) return { ok: false };
  const account = await resolveActivePortalAccount(patient);
  if (!account.ok) return { ok: false };
  return { ok: true, recipientUserId: account.user.id };
}

router.get("/portal/notifications", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: NOTIFICATIONS_SCHEMA_MSG });
    return;
  }
  const resolved = await resolvePortalNotificationRecipient(
    Number(req.portalUser!.patientId),
    req.portalUser!.patientHisId,
  );
  if (!resolved.ok) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const unreadOnly =
    String(req.query.unreadOnly ?? "") === "1" || String(req.query.unreadOnly ?? "") === "true";
  const result = await notificationsRepo.listNotificationsForUser(resolved.recipientUserId, {
    page,
    limit,
    unreadOnly,
  });
  res.json({
    data: result.data.map(formatPortalNotification),
    total: result.total,
    page,
    limit,
  });
});

router.get("/portal/notifications/unread-count", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.json({ count: 0 });
    return;
  }
  const resolved = await resolvePortalNotificationRecipient(
    Number(req.portalUser!.patientId),
    req.portalUser!.patientHisId,
  );
  if (!resolved.ok) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }
  const count = await notificationsRepo.countUnread(resolved.recipientUserId);
  res.json({ count });
});

router.post("/portal/notifications/:id/read", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: NOTIFICATIONS_SCHEMA_MSG });
    return;
  }
  const resolved = await resolvePortalNotificationRecipient(
    Number(req.portalUser!.patientId),
    req.portalUser!.patientHisId,
  );
  if (!resolved.ok) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  const existing = await notificationsRepo.findNotificationForUser(id, resolved.recipientUserId);
  if (!existing) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to mark another user's notification read",
      patientHisId: req.portalUser!.patientHisId,
    });
    return;
  }
  const updated = await notificationsRepo.markRead(id, resolved.recipientUserId);
  res.json(formatPortalNotification(updated!));
});

router.post("/portal/notifications/read-all", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: NOTIFICATIONS_SCHEMA_MSG });
    return;
  }
  const resolved = await resolvePortalNotificationRecipient(
    Number(req.portalUser!.patientId),
    req.portalUser!.patientHisId,
  );
  if (!resolved.ok) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }
  const updated = await notificationsRepo.markAllRead(resolved.recipientUserId);
  res.json({ updated });
});

router.get("/portal/overview", requirePortalAuth, async (req, res): Promise<void> => {
  void req.query?.patientId;

  const resolved = await resolvePortalProfilePatient(Number(req.portalUser!.patientId));
  if (!resolved.ok) {
    res.status(resolved.reason === "inactive" ? 401 : 404).json({
      error:
        resolved.reason === "inactive"
          ? "Invalid or expired portal session"
          : "Patient not found",
    });
    return;
  }
  const { patient } = resolved;

  const assigned = (await patientsRepo.listAssignedPhysicians(patient.id)).map((row) => ({
    id: row.id,
    name: physicianName(row.lastName, row.firstName),
    assignedAt: row.assignedAt.toISOString(),
  }));
  const formatted = formatPatient(
    patient,
    0,
    assigned.map((doctor) => ({ id: doctor.id, name: doctor.name })),
  );

  let appointments = buildPortalAppointmentsPayload({ ok: false, reason: "unconfigured" });
  try {
    const apptResult = await schedulerAppointmentsRepo.findPatientAppointments(
      patient.patientHisId,
      hospitalTodayIso(),
    );
    appointments = buildPortalAppointmentsPayload(apptResult);
  } catch (err) {
    logger.warn({ err }, "portal_appointments_load_failed");
    appointments = buildPortalAppointmentsPayload({ ok: false, reason: "unavailable" });
  }

  res.json({
    patient: {
      id: formatted.id,
      patientHisId: formatted.patientHisId,
      firstName: formatted.firstName,
      lastName: formatted.lastName,
      middleName: formatted.middleName,
      dateOfBirth: formatted.dateOfBirth,
      mobileNumber: formatted.mobileNumber,
      email: formatted.email,
    },
    assignedDoctors: assigned,
    appointments,
  });
});

/**
 * Unified care history (appointments + released results + prescriptions).
 * Identity from portal JWT only. Each source is isolated — one failure does not clear others.
 */
router.get("/portal/care-history", requirePortalAuth, async (req, res): Promise<void> => {
  void req.query?.patientId;
  void req.body?.patientId;

  const jwtPatientId = Number(req.portalUser!.patientId);
  const resolved = await resolvePortalProfilePatient(jwtPatientId);
  if (!resolved.ok) {
    res.status(resolved.reason === "inactive" ? 401 : 404).json({
      error:
        resolved.reason === "inactive"
          ? "Invalid or expired portal session"
          : "Patient not found",
    });
    return;
  }
  const { patient } = resolved;

  const sources: CareHistorySources = {
    appointments: { status: "unconfigured", message: "Appointment information is temporarily unavailable." },
    results: { status: "ok" },
    prescriptions: { status: "ok" },
  };

  let appointmentBundle:
    | {
        ok: true;
        recentPast: SchedulerAppointmentRow[];
        today: SchedulerAppointmentRow[];
        next: SchedulerAppointmentRow | null;
      }
    | { ok: false; reason: "unconfigured" | "unavailable" } = {
    ok: false,
    reason: "unconfigured",
  };

  let results: ResultRow[] = [];
  let prescriptions: PrescriptionWithItems[] = [];

  const [apptSettled, resultsSettled, rxSettled] = await Promise.allSettled([
    schedulerAppointmentsRepo.findCareTimelineAppointments(
      patient.patientHisId,
      hospitalTodayIso(),
    ),
    resultsRepo.listResultsForPatient(jwtPatientId, { status: "released" }),
    (async () => {
      if (!(await prescriptionsRepo.schemaReady())) {
        return { kind: "unconfigured" as const, rows: [] };
      }
      const rows = await prescriptionsRepo.listPrescriptionsForPatient(jwtPatientId);
      return { kind: "ok" as const, rows };
    })(),
  ]);

  if (apptSettled.status === "fulfilled") {
    appointmentBundle = apptSettled.value;
    sources.appointments = appointmentsSourceFromResult(apptSettled.value);
  } else {
    logger.warn({ err: apptSettled.reason }, "portal_care_history_appointments_failed");
    appointmentBundle = { ok: false, reason: "unavailable" };
    sources.appointments = appointmentsSourceFromResult(appointmentBundle);
  }

  if (resultsSettled.status === "fulfilled") {
    results = resultsSettled.value.slice(0, CARE_HISTORY_SOURCE_LIMIT);
    sources.results = { status: "ok" };
  } else {
    logger.warn({ err: resultsSettled.reason }, "portal_care_history_results_failed");
    sources.results = {
      status: "unavailable",
      message: "Result history is temporarily unavailable.",
    };
  }

  if (rxSettled.status === "fulfilled") {
    if (rxSettled.value.kind === "unconfigured") {
      sources.prescriptions = {
        status: "unconfigured",
        message: "Prescription information is temporarily unavailable.",
      };
      prescriptions = [];
    } else {
      prescriptions = rxSettled.value.rows.slice(0, CARE_HISTORY_SOURCE_LIMIT);
      sources.prescriptions = { status: "ok" };
    }
  } else {
    logger.warn({ err: rxSettled.reason }, "portal_care_history_prescriptions_failed");
    sources.prescriptions = {
      status: "unavailable",
      message: "Prescription information is temporarily unavailable.",
    };
  }

  const payload: CareHistoryPayload = {
    events: buildCareHistoryEvents({
      jwtPatientId,
      appointments: appointmentBundle,
      results,
      prescriptions,
    }),
    sources,
  };

  res.json(payload);
});

router.get("/portal/profile", requirePortalAuth, async (req, res): Promise<void> => {
  // JWT.patientId only — ignore any client-supplied patientId.
  void req.query?.patientId;
  void req.body?.patientId;

  const resolved = await resolvePortalProfilePatient(Number(req.portalUser!.patientId));
  if (!resolved.ok) {
    res.status(resolved.reason === "inactive" ? 401 : 404).json({
      error:
        resolved.reason === "inactive"
          ? "Invalid or expired portal session"
          : "Patient not found",
    });
    return;
  }

  res.json(formatPortalProfile(resolved.patient, resolved.portalUser));
});

router.patch("/portal/profile", requirePortalAuth, async (req, res): Promise<void> => {
  // Client must never control which patient record is updated.
  void req.body?.patientId;
  void req.body?.id;
  void req.body?.patientHisId;
  void req.body?.firstName;
  void req.body?.middleName;
  void req.body?.lastName;
  void req.body?.dateOfBirth;
  void req.body?.portalUserId;
  void req.body?.createdById;
  void req.body?.accessCodeHash;

  const result = await updatePortalProfileContact(Number(req.portalUser!.patientId), req.body);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  if (result.emailChanged || result.mobileChanged) {
    await logAudit({
      action: "edit",
      req,
      patientHisId: result.patient.patientHisId,
      details: profileAuditDetails(result.emailChanged, result.mobileChanged),
    });
  }

  res.json(formatPortalProfile(result.patient, result.portalUser));
});

router.get("/portal/results", requirePortalAuth, async (req, res): Promise<void> => {
  const patient = await patientsRepo.findPatientById(req.portalUser!.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const accessOk = await verifyPortalResultsAccessCode(req, patient);
  if (!accessOk) {
    res.status(403).json({ error: RESULTS_ACCESS_REQUIRED_ERROR, code: "RESULTS_LOCKED" });
    return;
  }

  const results = await resultsRepo.listResultsForPatient(req.portalUser!.patientId, {
    status: "released",
  });
  res.json(
    results.map((r) => ({
      id: r.id,
      category: r.category,
      originalFileName: r.originalFileName,
      fileType: r.fileType,
      fileSizeBytes: r.fileSizeBytes ?? 0,
      status: r.status,
      remarks: r.remarks ?? null,
      uploadedAt: r.uploadedAt.toISOString(),
      dateReleased: r.dateReleased ? r.dateReleased.toISOString() : null,
    })),
  );
});

router.get("/portal/medications", requirePortalAuth, async (req, res): Promise<void> => {
  const patient = await patientsRepo.findPatientById(req.portalUser!.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const portalAccount = await resolveActivePortalAccount(patient);
  if (!portalAccount.ok) {
    await denyAccess(req, res, {
      error: "Portal account is not active",
      details: "Unauthorized portal medications access without active portal account",
    });
    return;
  }

  // Ignore any client-supplied patientId / userId query params.
  if (!(await prescriptionsRepo.schemaReady())) {
    res.status(503).json({
      error:
        "Prescriptions schema is not installed. Run docs/migration/sql/011_create_prescriptions.sql against ACE_ResultsPortal.",
    });
    return;
  }

  const rows = await prescriptionsRepo.listPrescriptionsForPatient(req.portalUser!.patientId);
  res.json(rows.map(formatPrescription));
});

router.get("/portal/medications/:id", requirePortalAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid medication id" });
    return;
  }

  const patient = await patientsRepo.findPatientById(req.portalUser!.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  const portalAccount = await resolveActivePortalAccount(patient);
  if (!portalAccount.ok) {
    await denyAccess(req, res, {
      error: "Portal account is not active",
      details: "Unauthorized portal medication detail without active portal account",
    });
    return;
  }

  if (!(await prescriptionsRepo.schemaReady())) {
    res.status(503).json({
      error:
        "Prescriptions schema is not installed. Run docs/migration/sql/011_create_prescriptions.sql against ACE_ResultsPortal.",
    });
    return;
  }

  const row = await prescriptionsRepo.findPrescriptionByIdForPatient(id, req.portalUser!.patientId);
  if (!row) {
    // Uniform 404 — do not reveal foreign prescriptions.
    res.status(404).json({ error: "Prescription not found" });
    return;
  }
  res.json(formatPrescription(row));
});

router.get("/portal/results/:id/download", requirePortalAuth, async (req, res): Promise<void> => {
  const params = GetPortalResultDownloadUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const patient = await patientsRepo.findPatientById(req.portalUser!.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const accessOk = await verifyPortalResultsAccessCode(req, patient);
  if (!accessOk) {
    res.status(403).json({ error: RESULTS_ACCESS_REQUIRED_ERROR, code: "RESULTS_LOCKED" });
    return;
  }

  const result = await resultsRepo.findResultById(params.data.id);
  if (!result || !canPortalAccessResult(result, req.portalUser!.patientId)) {
    res.status(404).json({ error: "Result not found or not yet released" });
    return;
  }

  const token = signDownloadToken({
    resultId: result.id,
    forType: "portal",
    subjectId: req.portalUser!.patientId,
  });
  await logAudit({
    action: "download",
    req,
    patientHisId: req.portalUser!.patientHisId,
    resultId: result.id,
    details: "Patient downloaded result",
  });
  res.json({
    url: `/api/portal/file/${token}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
});

router.get("/portal/file/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const payload = verifyToken(token);
  if (!payload || payload["type"] !== "download" || payload["forType"] !== "portal") {
    res.status(401).json({ error: "Invalid or expired download link" });
    return;
  }

  const resultId = payload["resultId"] as number;
  const subjectId = payload["subjectId"] as number | undefined;
  const result = await resultsRepo.findResultById(resultId);
  if (!result || result.status !== "released") {
    res.status(404).json({ error: "Result not found or not released" });
    return;
  }
  if (!subjectId || !canPortalAccessResult(result, subjectId)) {
    await denyAccess(req, res, {
      error: "Not authorized to download this result",
      details: "Unauthorized attempt to stream portal result via token",
      userId: subjectId ?? null,
      resultId: result.id,
    });
    return;
  }

  let filePath: string;
  try {
    filePath = getFilePath(result.fileName);
  } catch {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  res.setHeader("Content-Type", mimeMap[result.fileType] ?? "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(result.originalFileName)}"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(filePath).pipe(res);
});

router.post("/portal/change-password", requirePortalAuth, async (req, res): Promise<void> => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current password and new password are required" });
    return;
  }
  if (
    !isValidPortalPassword(newPassword)
  ) {
    res.status(400).json({ error: PORTAL_PASSWORD_REQUIREMENTS_MSG });
    return;
  }

  const resolvedProfile = await resolvePortalProfilePatient(Number(req.portalUser!.patientId));
  if (!resolvedProfile.ok) {
    res.status(resolvedProfile.reason === "inactive" ? 401 : 404).json({
      error:
        resolvedProfile.reason === "inactive"
          ? "Invalid or expired portal session"
          : "Patient not found",
    });
    return;
  }
  const portalAccount = await resolveActivePortalAccount(resolvedProfile.patient);
  if (!portalAccount.ok) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }

  const valid = await comparePassword(currentPassword, portalAccount.user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  if (!isValidPortalPassword(newPassword)) {
    res.status(400).json({ error: PORTAL_PASSWORD_REQUIREMENTS_MSG });
    return;
  }

  const nextHash = await hashPassword(newPassword);
  await usersRepo.setUserPassword(portalAccount.user.id, nextHash, false);

  await logAudit({
    action: "edit",
    req,
    patientHisId: resolvedProfile.patient.patientHisId,
    details: "portal_password_changed",
  });
  res.json({ message: "Password changed successfully" });
});

/** Patient requests a new results access code — notifies admins; does not regenerate immediately. */
router.post("/portal/request-access-code", requirePortalAuth, portalLimiter, async (req, res): Promise<void> => {
  const patient = await patientsRepo.findPatientById(req.portalUser!.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const portalAccount = await resolveActivePortalAccount(patient);
  if (!portalAccount.ok) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return;
  }

  const updated = await patientsRepo.setAccessCodeRequestedAt(patient.id);
  if (!updated) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const patientLabel = `${patient.firstName} ${patient.lastName}`.trim();
  let notified = 0;
  if (await notificationsRepo.messagingSchemaReady()) {
    const adminIds = await notificationsRepo.listActiveAdminUserIds();
    notified = await notificationsRepo.insertNotificationsDeduped(adminIds, {
      type: "access_code_requested",
      title: "Access code requested",
      body: `${patientLabel} (HIS ${patient.patientHisId}) requested a new results access code.`,
      entityType: "patient",
      entityId: patient.id,
      priority: "important",
    });
  }

  await logAudit({
    action: "edit",
    req,
    patientHisId: patient.patientHisId,
    details: JSON.stringify({
      source: "ACE_ResultsPortal",
      operation: "portal_access_code_requested",
      result: "success",
      notified,
    }),
  });

  res.json({
    success: true,
    message:
      "Your request was sent to ACE Medical Center Cebu. Staff will issue a new access code and email it when ready.",
    requestedAt: updated.accessCodeRequestedAt?.toISOString() ?? new Date().toISOString(),
  });
});

router.post("/portal/logout", requirePortalAuth, async (req, res): Promise<void> => {
  const sid = req.portalUser!.sessionPublicId;
  const userId = req.portalUser!.userId;
  if (!sid || userId == null) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await authSessionsRepo.revokeByPublicId(sid, userId);
  res.clearCookie(sessionRefreshCookieName(sid), { ...refreshCookieOptions(), maxAge: 0 });
  await logAudit({
    action: "logout",
    req,
    patientHisId: req.portalUser!.patientHisId,
    userId,
    details: "session_logout portal=patient",
  });
  res.json({ message: "Logged out successfully" });
});

export default router;
