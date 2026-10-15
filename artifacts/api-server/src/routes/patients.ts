import { Router } from "express";
import {
  HospitalQueryError,
  PatientDepartmentSchemaError,
  authSessionsRepo,
  hospitalPatientsRepo,
  patientDepartmentsRepo,
  patientsRepo,
  patientPhysiciansRepo,
  resultPhysiciansRepo,
  resultsRepo,
  usersRepo,
  withTransaction,
} from "@workspace/db";
import {
  ListPatientsQueryParams,
  GetPatientParams,
  UpdatePatientParams,
  DeletePatientParams,
  RegenerateAccessCodeParams,
  CreatePatientBody,
  UpdatePatientBody,
  ListPatientResultsStaffParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  generateAccessCode,
  hashAccessCode,
  hashPassword,
  maskEmail,
  signStaffPatientReuseToken,
  verifyStaffPatientReuseToken,
} from "../lib/auth";
import { PORTAL_USER_ROLE } from "@workspace/db";
import { denyAccess, logAudit } from "../lib/audit";
import { formatPatient, formatResult, physicianName, resolvePatientPortalEmail } from "../lib/formatters";
import { loadReviewExtras } from "../lib/result-review";
import {
  canAssignPhysicians,
  canCreatePatients,
  canDeletePatients,
  canEditPatients,
  canRegenerateAccessCode,
  resolveResultCategoryScope,
  scopeFailure,
} from "../lib/rbac";
import { HIS_UNAVAILABLE_MESSAGE } from "../lib/portal-his-verify";
import { isUniqueConstraintError } from "../lib/portal-registration";
import {
  STAFF_HOSPITAL_LOOKUP_UNAVAILABLE,
  assembleStaffHospitalLookup,
  existingPatientCreateDecision,
} from "../lib/staff-hospital-lookup";
import {
  PATIENT_DEPARTMENT_SCHEMA_MESSAGE,
  assertStaffMayAccessPatient,
  resolveRegistrationDepartment,
  staffDirectoryConstraint,
} from "../lib/patient-department-access";
import { EMAIL_UNAVAILABLE_MESSAGE, isPortalEmailConfigured, sendPortalEmail } from "../lib/portal-email";
import { issueAccessCodeAndEmail } from "../lib/access-code-email";
import {
  beginRegistrationAccessCodeSend,
  clearRegistrationAccessCode,
  endRegistrationAccessCodeSend,
  rememberRegistrationAccessCode,
} from "../lib/registration-access-code-cache";
import { normalizePortalEmail } from "../lib/portal-profile";
import { logger } from "../lib/logger";
import type { Request, Response } from "express";

const router = Router();

async function enforceDepartmentPatient(
  req: Request,
  res: Response,
  patientId: number,
  patientHisId?: string,
): Promise<boolean> {
  const gate = await assertStaffMayAccessPatient(req.user!.role, patientId);
  if (gate.ok) return true;
  if (gate.status === 403) {
    await denyAccess(req, res, {
      error: gate.error,
      details: "Unauthorized attempt to access a patient outside department membership",
      patientHisId,
    });
    return false;
  }
  res.status(gate.status).json({ error: gate.error });
  return false;
}

function parseOptionalBoolQuery(value: unknown): boolean | undefined {
  if (value == null || value === "") return undefined;
  const raw = String(value).trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return undefined;
}

async function resolveStaffPatientScope(
  req: Request,
  res: Response,
): Promise<{ ok: true; ids?: number[] } | { ok: false }> {
  if (req.user!.role === "physician") {
    const ids = await patientPhysiciansRepo.listAssignedPatientIds(req.user!.userId);
    return { ok: true, ids };
  }
  const constraint = await staffDirectoryConstraint(req.user!.role);
  if (constraint.kind === "error") {
    if (constraint.status === 403) {
      await denyAccess(req, res, {
        error: constraint.error,
        details: "Unauthorized attempt to list patients outside department membership",
      });
      return { ok: false };
    }
    res.status(constraint.status).json({ error: constraint.error });
    return { ok: false };
  }
  if (constraint.kind === "ids") return { ok: true, ids: constraint.ids };
  return { ok: true };
}

router.get("/patients", requireAuth, async (req, res): Promise<void> => {
  const params = ListPatientsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { search, page = 1, limit = 20 } = params.data;
  const hasResults = parseOptionalBoolQuery(req.query.hasResults);
  const hasPhysician = parseOptionalBoolQuery(req.query.hasPhysician);
  const scope = await resolveStaffPatientScope(req, res);
  if (!scope.ok) return;
  const ids = scope.ids;
  if (ids && ids.length === 0) {
    res.json({ data: [], total: 0, page, limit });
    return;
  }

  const result = await patientsRepo.listPatients({
    search,
    ids,
    page,
    limit,
    hasResults,
    hasPhysician,
  });
  const patientIds = result.data.map((p) => p.id);
  const countStatus = req.user!.role === "physician" ? ("released" as const) : undefined;
  const portalUserIds = result.data
    .map((patient) => patient.portalUserId)
    .filter((id): id is number => id != null);
  const [counts, physiciansByPatient, portalUsers] = await Promise.all([
    resultsRepo.countResultsByPatientIds(patientIds, { status: countStatus }),
    patientsRepo.listAssignedPhysiciansForPatients(patientIds),
    usersRepo.findUsersByIds(portalUserIds),
  ]);
  const activePortalUserIds = new Set(
    portalUsers
      .filter((user) => user.isActive && user.role === PORTAL_USER_ROLE)
      .map((user) => user.id),
  );
  res.json({
    data: result.data.map((p) => {
      const assigned = (physiciansByPatient.get(p.id) ?? []).map((r) => ({
        id: r.id,
        name: physicianName(r.lastName, r.firstName),
      }));
      return {
        ...formatPatient(p, counts[p.id] ?? 0, assigned),
        portalActive: p.portalUserId != null && activePortalUserIds.has(p.portalUserId),
      };
    }),
    total: result.total,
    page,
    limit,
  });
});

/** Staff Desk Patients summary cards — same visibility scope as GET /patients. */
router.get("/patients/directory-summary", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role === "patient") {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to view staff patient directory summary",
    });
    return;
  }
  const scope = await resolveStaffPatientScope(req, res);
  if (!scope.ok) return;
  try {
    const stats = await patientsRepo.getDirectoryStats(scope.ids);
    res.json(stats);
  } catch (err) {
    logger.error(
      { err, userId: req.user!.userId, role: req.user!.role },
      "Failed to load patient directory summary",
    );
    res.status(500).json({ error: "Unable to load patient directory summary" });
  }
});

/**
 * Staff hospital identity lookup (read-only LiveDB_ACE).
 * Returns verified demographics so the UI can populate portal-only fields.
 */
router.get("/patients/hospital-lookup", requireAuth, async (req, res): Promise<void> => {
  if (!canCreatePatients(req.user!.role) && !canEditPatients(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to look up hospital patient identity",
    });
    return;
  }
  const patientHisId =
    typeof req.query.patientHisId === "string" ? req.query.patientHisId.trim() : "";
  if (!patientHisId || patientHisId.length > 64) {
    res.status(400).json({ error: "patientHisId is required" });
    return;
  }

  try {
    const matches = await hospitalPatientsRepo.findHospitalPatientMatches(patientHisId);
    const assembled = await assembleStaffHospitalLookup({
      role: req.user!.role,
      staffUserId: req.user!.userId,
      matches,
      findPortalPatient: (hisId) => patientsRepo.findPatientByHisId(hisId),
      findPortalUser: (userId) => usersRepo.findUserById(userId),
      membershipExists: async (patientId, departmentId) =>
        Boolean(await patientDepartmentsRepo.findMembership(patientId, departmentId)),
      signReuseToken: signStaffPatientReuseToken,
    });
    if (!assembled.ok) {
      if (assembled.status === 403) {
        await denyAccess(req, res, {
          error: assembled.error,
          details: "Unauthorized attempt to look up hospital patient identity",
        });
        return;
      }
      res.status(assembled.status).json({ error: assembled.error });
      return;
    }
    res.json(assembled.body);
  } catch (err) {
    if (err instanceof HospitalQueryError) {
      logger.error({ err: err.cause ?? err }, "staff_hospital_lookup_unavailable");
      res.status(503).json({ error: STAFF_HOSPITAL_LOOKUP_UNAVAILABLE });
      return;
    }
    if (err instanceof PatientDepartmentSchemaError) {
      res.status(503).json({ error: PATIENT_DEPARTMENT_SCHEMA_MESSAGE });
      return;
    }
    throw err;
  }
});

router.post("/patients", requireAuth, async (req, res): Promise<void> => {
  if (!canCreatePatients(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to create patient",
    });
    return;
  }

  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let hospital;
  try {
    hospital = await hospitalPatientsRepo.getHospitalPatientByHisId(parsed.data.patientHisId);
  } catch (err) {
    if (err instanceof HospitalQueryError) {
      logger.error({ err: err.cause ?? err }, "staff_patient_create_his_unavailable");
      res.status(503).json({ error: HIS_UNAVAILABLE_MESSAGE });
      return;
    }
    throw err;
  }

  if (!hospital || hospital.isDeceased) {
    res.status(404).json({
      error: "Hospital patient record could not be verified. Patient was not created.",
    });
    return;
  }

  const existing = await patientsRepo.findPatientByHisId(hospital.patientHisId);
  const registration = await resolveRegistrationDepartment(req.user!.role);
  if (registration.status === "misconfigured") {
    res.status(500).json({ error: "Unable to authorize this request." });
    return;
  }
  if (registration.status === "forbidden" || registration.status === "not_staff") {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to register a patient without a department",
    });
    return;
  }
  if (registration.status === "department" && !(await patientDepartmentsRepo.tableExists())) {
    res.status(503).json({ error: PATIENT_DEPARTMENT_SCHEMA_MESSAGE });
    return;
  }

  if (existing) {
    const rawToken = typeof req.body?.reuseToken === "string" ? req.body.reuseToken : "";
    const clientDepartmentId = Number(req.body?.departmentId);
    const decision = existingPatientCreateDecision({
      token: rawToken ? verifyStaffPatientReuseToken(rawToken) : null,
      staffUserId: req.user!.userId,
      hospitalHisId: hospital.patientHisId,
      registration,
      clientDepartmentId: Number.isFinite(clientDepartmentId) ? clientDepartmentId : null,
    });
    if (decision === "forbidden") {
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to reuse a patient outside the verified lookup",
        patientHisId: existing.patientHisId,
      });
      return;
    }
    if (decision === "conflict") {
      res.status(409).json({
        error: "Patient ID already exists in the system",
        existingPatient: {
          id: existing.id,
          patientHisId: existing.patientHisId,
          lastName: existing.lastName,
          firstName: existing.firstName,
        },
      });
      return;
    }
    if (registration.status === "department") {
      await patientDepartmentsRepo.ensureMembership({
        patientId: existing.id,
        departmentId: registration.departmentId,
        registeredById: req.user!.userId,
      });
    }
    await logAudit({
      action: "edit",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      patientHisId: existing.patientHisId,
      details: JSON.stringify({
        operation: "staff_patient_department_link",
        result: "success",
      }),
    });
    const resultCount = await resultsRepo.countResultsForPatient(existing.id);
    res.status(200).json(formatPatient(existing, resultCount));
    return;
  }

  const physicianId = parsed.data.physicianId ?? null;
  if (physicianId && !canAssignPhysicians(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Not authorized to assign physicians",
      details: "Unauthorized attempt to assign physician",
    });
    return;
  }

  const plaintextCode = generateAccessCode();
  const accessCodeHash = await hashAccessCode(plaintextCode);

  const patient = await withTransaction(async (tx) => {
    const created = await patientsRepo.insertPatient(
      {
        patientHisId: hospital.patientHisId,
        lastName: hospital.lastName,
        firstName: hospital.firstName,
        middleName: hospital.middleName,
        dateOfBirth: hospital.dateOfBirth,
        mobileNumber: parsed.data.mobileNumber ?? null,
        email: parsed.data.email ?? null,
        accessCodeHash,
        createdById: req.user!.userId,
      },
      tx,
    );

    if (physicianId) {
      const physician = await usersRepo.findUserByIdTx(tx, physicianId);
      if (!physician || physician.role !== "physician" || !physician.isActive) {
        throw Object.assign(new Error("Physician not found"), { status: 404 });
      }
      await patientPhysiciansRepo.insertAssignment(
        { patientId: created.id, physicianId: physician.id, assignedById: req.user!.userId },
        tx,
      );
    }

    if (registration.status === "department") {
      await patientDepartmentsRepo.ensureMembership(
        {
          patientId: created.id,
          departmentId: registration.departmentId,
          registeredById: req.user!.userId,
        },
        tx,
      );
    }

    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        patientHisId: created.patientHisId,
        details: JSON.stringify({
          source: "LiveDB_ACE",
          operation: "staff_patient_create_from_his",
          result: "success",
        }),
      },
      tx,
    );
    return created;
  }).catch(async (err: Error & { status?: number }) => {
    if (err.status === 404) {
      res.status(404).json({ error: "Physician not found" });
      return null;
    }
    if (isUniqueConstraintError(err)) {
      const raced = await patientsRepo.findPatientByHisId(hospital.patientHisId);
      res.status(409).json({
        error: "Patient ID already exists in the system",
        ...(raced
          ? {
              existingPatient: {
                id: raced.id,
                patientHisId: raced.patientHisId,
                lastName: raced.lastName,
                firstName: raced.firstName,
              },
            }
          : {}),
      });
      return null;
    }
    throw err;
  });

  if (!patient) return;

  // Plaintext is available only for this response and a short-lived in-memory email window.
  // The database stores only the hash.
  rememberRegistrationAccessCode(patient.id, req.user!.userId, plaintextCode);

  res.status(201).json({
    ...formatPatient(patient, 0, [], plaintextCode),
    accessCode: plaintextCode,
  });
});

router.get("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const patient = await patientsRepo.findPatientById(params.data.id);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  if (req.user!.role === "physician") {
    const assignment = await patientPhysiciansRepo.findAssignment(params.data.id, req.user!.userId);
    if (!assignment) {
      await denyAccess(req, res, {
        error: "Not authorized to view this patient",
        details: "Unauthorized attempt to access patient",
        patientHisId: patient.patientHisId,
      });
      return;
    }
  } else if (!(await enforceDepartmentPatient(req, res, patient.id, patient.patientHisId))) {
    return;
  }

  const resultCount = await resultsRepo.countResultsForPatient(patient.id, {
    status: req.user!.role === "physician" ? "released" : undefined,
  });
  const physicianRows = await patientsRepo.listAssignedPhysicians(patient.id);
  const assignedPhysicians = physicianRows.map((r) => ({
    id: r.id,
    name: physicianName(r.lastName, r.firstName),
  }));

  let portalActive = false;
  if (patient.portalUserId != null) {
    const portalUser = await usersRepo.findUserById(patient.portalUserId);
    portalActive = Boolean(
      portalUser && portalUser.isActive && portalUser.role === PORTAL_USER_ROLE,
    );
  }

  res.json({
    ...formatPatient(patient, resultCount, assignedPhysicians),
    portalActive,
  });
});

router.patch("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  if (!canEditPatients(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to modify patient",
    });
    return;
  }
  const params = UpdatePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await patientsRepo.findPatientById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!(await enforceDepartmentPatient(req, res, existing.id, existing.patientHisId))) {
    return;
  }

  const patient = await patientsRepo.updatePatient(params.data.id, {
    lastName: parsed.data.lastName,
    firstName: parsed.data.firstName,
    middleName: parsed.data.middleName,
    dateOfBirth: parsed.data.dateOfBirth,
    mobileNumber: parsed.data.mobileNumber,
    email: parsed.data.email,
  });
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "Updated patient record",
  });

  const resultCount = await resultsRepo.countResultsForPatient(patient.id);
  res.json(formatPatient(patient, resultCount));
});

router.delete("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  if (!canDeletePatients(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to delete patient",
    });
    return;
  }
  const params = DeletePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await patientsRepo.findPatientById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!(await enforceDepartmentPatient(req, res, existing.id, existing.patientHisId))) {
    return;
  }

  const resultCount = await resultsRepo.countResultsForPatient(existing.id);
  if (resultCount > 0) {
    res.status(409).json({
      error: "Cannot delete a patient who has diagnostic results. Archive results first.",
    });
    return;
  }

  const patient = await withTransaction(async (tx) => {
    await patientPhysiciansRepo.deleteAssignmentsForPatient(params.data.id, tx);
    const deleted = await patientsRepo.deletePatient(params.data.id, tx);
    if (!deleted) return null;
    await logAudit(
      {
        action: "delete",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        patientHisId: deleted.patientHisId,
        details: "Deleted patient record (no results on file)",
      },
      tx,
    );
    return deleted;
  });

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  res.json({ message: "Patient record deleted successfully" });
});

router.post("/patients/:id/regenerate-access-code", requireAuth, async (req, res): Promise<void> => {
  if (!canRegenerateAccessCode(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to regenerate patient access code",
    });
    return;
  }
  const params = RegenerateAccessCodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await patientsRepo.findPatientById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!(await enforceDepartmentPatient(req, res, existing.id, existing.patientHisId))) {
    return;
  }

  const plaintextCode = generateAccessCode();
  const accessCodeHash = await hashAccessCode(plaintextCode);
  const patient = await patientsRepo.updateAccessCodeHash(params.data.id, accessCodeHash);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  clearRegistrationAccessCode(patient.id);
  rememberRegistrationAccessCode(patient.id, req.user!.userId, plaintextCode);

  await logAudit({
    action: "access_code_regen",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "New results access code issued (previous invalidated)",
  });

  const resultCount = await resultsRepo.countResultsForPatient(patient.id);
  res.json(formatPatient(patient, resultCount, [], plaintextCode));
});

/**
 * Always issues a brand-new results access code, emails it, and invalidates the previous code.
 * Never re-sends a code that was already shown or used — patient codes do not expire on a timer.
 */
router.post("/patients/:id/email-access-code", requireAuth, async (req, res): Promise<void> => {
  if (!canRegenerateAccessCode(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to email patient access code",
    });
    return;
  }
  const params = RegenerateAccessCodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await patientsRepo.findPatientById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!(await enforceDepartmentPatient(req, res, existing.id, existing.patientHisId))) {
    return;
  }

  const email = resolvePatientPortalEmail(existing.email);
  if (!email) {
    res.status(400).json({ error: "This patient has no portal email on file." });
    return;
  }

  const issued = await issueAccessCodeAndEmail({
    patient: existing,
    email,
    subject: "ACE Medical Center Cebu — Your Patient Portal access code",
    text: (accessCode) =>
      [
        "Your Patient Portal results access code is ready.",
        "",
        `Access code: ${accessCode}`,
        "",
        "Use this code to unlock Results in the Patient Portal. It does not expire — keep it secure and reuse it whenever you view results.",
        "It is separate from your sign-in password. Any previous access code no longer works.",
        "",
        "If you did not request this, contact ACE Medical Center Cebu Medical Records.",
      ].join("\n"),
  });

  if (!issued.ok) {
    res.status(issued.status).json({
      error: issued.error,
      credentialIssued: false,
      emailAccepted: issued.emailAccepted,
      hashUnchanged: issued.hashUnchanged,
      ...("deliveryUncertain" in issued && issued.deliveryUncertain ? { deliveryUncertain: true } : {}),
      ...("activationUncertain" in issued ? { activationUncertain: true } : {}),
    });
    return;
  }

  clearRegistrationAccessCode(issued.patient.id);

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: issued.patient.patientHisId,
    details: "portal_access_code_issued_and_emailed",
  });

  res.json({
    success: true,
    credentialIssued: true,
    emailAccepted: true,
    accessCode: issued.accessCode,
    message: "A new access code was issued and emailed to the patient.",
  });
});

/**
 * Email the diagnostic access code issued at registration (or regenerate) without replacing the hash.
 * Plaintext is read from a short-lived in-memory cache — never recovered from the database hash.
 * Optional body.email updates the hospital patient email, then sends.
 *
 * Process-local cache/lock only: restarts and other app instances cannot see the pending code.
 */
router.post("/patients/:id/email-diagnostic-access-code", requireAuth, async (req, res): Promise<void> => {
  if (!canRegenerateAccessCode(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to email diagnostic access code",
    });
    return;
  }

  const params = RegenerateAccessCodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await patientsRepo.findPatientById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!(await enforceDepartmentPatient(req, res, existing.id, existing.patientHisId))) {
    return;
  }

  let emailSaved = false;
  let patient = existing;
  const rawEmail = req.body?.email;

  if (rawEmail !== undefined && rawEmail !== null) {
    const normalized = normalizePortalEmail(rawEmail);
    if (typeof normalized === "object" && normalized !== null) {
      res.status(400).json({
        error: normalized.error,
        emailSaved: false,
        delivery: "not_attempted",
      });
      return;
    }
    if (typeof normalized !== "string" || !normalized) {
      res.status(400).json({
        error: "Email is required.",
        emailSaved: false,
        delivery: "not_attempted",
      });
      return;
    }
    const updated = await patientsRepo.updatePatient(existing.id, { email: normalized });
    if (!updated) {
      res.status(404).json({ error: "Patient not found", emailSaved: false, delivery: "not_attempted" });
      return;
    }
    patient = updated;
    emailSaved = true;
    await logAudit({
      action: "edit",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      patientHisId: patient.patientHisId,
      details: JSON.stringify({
        operation: "patient_email_updated_for_access_code_send",
        result: "success",
      }),
    });
  }

  const email = resolvePatientPortalEmail(patient.email);
  if (!email) {
    res.status(400).json({
      error: "An email address is required to send this access code. Add the patient's email address to continue.",
      emailSaved,
      delivery: "not_attempted",
      reason: "email_required",
    });
    return;
  }

  if (!isPortalEmailConfigured()) {
    res.status(503).json({
      error: EMAIL_UNAVAILABLE_MESSAGE,
      emailSaved,
      delivery: "failed",
      reason: "smtp_unavailable",
    });
    return;
  }

  const claimed = beginRegistrationAccessCodeSend(existing.id);
  if (!claimed.ok) {
    if (claimed.reason === "in_flight") {
      res.status(409).json({
        error: "An email send for this access code is already in progress. Wait for it to finish before retrying.",
        emailSaved,
        delivery: "not_attempted",
        reason: "send_in_progress",
      });
      return;
    }
    res.status(410).json({
      error:
        "The access code is no longer available for email delivery. Reissue the code using the authorized access-code workflow, then send the new code.",
      emailSaved,
      delivery: "not_attempted",
      reason: "pending_code_unavailable",
      nextAction: "view_patient_regenerate",
    });
    return;
  }

  const hashBefore = existing.accessCodeHash;
  let sent = false;
  try {
    try {
      sent = await sendPortalEmail(
        email,
        "ACE Medical Center Cebu — Diagnostic results access code",
        [
          `Dear ${patient.firstName} ${patient.lastName},`,
          "",
          "ACE Medical Center Cebu is sending your diagnostic results access code.",
          "",
          `Access code: ${claimed.code}`,
          "",
          "Use this code in the Patient Portal to unlock your diagnostic results.",
          "This code does not create a Patient Portal account and is not your portal password.",
          "",
          "Keep this code secure. If you did not expect this message, contact ACE Medical Center Cebu Medical Records.",
          "",
          "— ACE Medical Center Cebu",
        ].join("\n"),
      );
    } catch (err) {
      logger.error({ err, patientId: existing.id }, "diagnostic_access_code_email_transport_error");
      sent = false;
    }
  } finally {
    endRegistrationAccessCodeSend(existing.id, sent ? "accepted" : "failed");
  }

  const after = await patientsRepo.findPatientById(patient.id);
  if (after && after.accessCodeHash !== hashBefore) {
    logger.error(
      { patientId: patient.id },
      "diagnostic_access_code_hash_changed_during_email_send",
    );
  }

  if (!sent) {
    res.status(503).json({
      error: EMAIL_UNAVAILABLE_MESSAGE,
      emailSaved,
      delivery: "failed",
      reason: "smtp_failed",
    });
    return;
  }

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: JSON.stringify({
      operation: "diagnostic_access_code_email_accepted",
      result: "success",
      emailSaved,
    }),
  });

  res.json({
    success: true,
    emailSaved,
    delivery: "accepted",
    emailedToMasked: maskEmail(email),
    message: `Email accepted for sending to ${maskEmail(email)}.`,
  });
});

router.post("/patients/:id/reset-portal-password", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (
    newPassword.length < 8 ||
    !/\d/.test(newPassword) ||
    !/[A-Z]/.test(newPassword) ||
    !/[a-z]/.test(newPassword) ||
    !/[^A-Za-z0-9]/.test(newPassword)
  ) {
    res.status(400).json({ error: "New password does not meet the security requirements" });
    return;
  }

  const patient = await patientsRepo.findPatientById(params.data.id);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  if (patient.portalUserId == null) {
    res.status(400).json({ error: "This hospital patient has no Patient Portal account." });
    return;
  }
  const owner = await usersRepo.findUserById(patient.portalUserId);
  if (!owner || owner.role !== PORTAL_USER_ROLE) {
    res.status(400).json({ error: "Linked Patient Portal account was not found." });
    return;
  }
  if (!owner.isActive) {
    res.status(409).json({
      error: "Portal account is inactive. Reactivate the account before resetting the password.",
    });
    return;
  }

  const nextHash = await hashPassword(newPassword);
  // Password reset must never overwrite the diagnostic access-code hash.
  await usersRepo.setUserPassword(owner.id, nextHash, true, {
    mustChangePassword: true,
    passwordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await authSessionsRepo.revokeAllForUser(owner.id);

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "Admin reset patient portal password",
  });
  res.json({ message: "Portal password reset successfully" });
});

router.get("/patients/:id/results", requireAuth, async (req, res): Promise<void> => {
  const params = ListPatientResultsStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const patient = await patientsRepo.findPatientById(params.data.id);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const role = req.user!.role;
  if (role === "physician") {
    const assignment = await patientPhysiciansRepo.findAssignment(params.data.id, req.user!.userId);
    if (!assignment) {
      await denyAccess(req, res, {
        error: "Not authorized to view this patient's results",
        details: "Unauthorized attempt to access patient results",
        patientHisId: patient.patientHisId,
      });
      return;
    }
  } else if (!(await enforceDepartmentPatient(req, res, patient.id, patient.patientHisId))) {
    return;
  }

  const scope = await resolveResultCategoryScope(role);
  const failure = scopeFailure(scope);
  if (failure) {
    if (failure.status === 403) {
      await denyAccess(req, res, {
        error: failure.error,
        details: "Unauthorized attempt to list patient results outside department scope",
        patientHisId: patient.patientHisId,
      });
      return;
    }
    res.status(failure.status).json({ error: failure.error });
    return;
  }
  if (scope.status !== "ok") {
    res.json([]);
    return;
  }
  const results = await resultsRepo.listResultsForPatient(params.data.id, {
    status: role === "physician" ? "released" : undefined,
    categories: scope.categories === "all" ? undefined : scope.categories,
  });

  res.json(
    await Promise.all(
      results.map(async (r) => {
        const reviewerIds = await resultPhysiciansRepo.listPhysicianIdsForResult(r.id);
        const assignedPhysicians = (
          await Promise.all(
            reviewerIds.map(async (physicianId) => {
              const doc = await usersRepo.findUserById(physicianId);
              return doc
                ? { id: doc.id, name: `Dr. ${doc.lastName}, ${doc.firstName}` }
                : null;
            }),
          )
        ).filter((row): row is { id: number; name: string } => row != null);
        return formatResult(r, {
          patientHisId: patient.patientHisId,
          patientName: `${patient.lastName}, ${patient.firstName}`,
          assignedPhysician: assignedPhysicians[0] ?? null,
          assignedPhysicians,
          ...(await loadReviewExtras(r.id, req.user!, assignedPhysicians)),
        });
      }),
    ),
  );
});

router.get("/patients/:id/physicians", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid patient ID" });
    return;
  }
  if (req.user!.role === "physician") {
    const assignment = await patientPhysiciansRepo.findAssignment(id, req.user!.userId);
    if (!assignment) {
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to access patient",
      });
      return;
    }
  } else if (!(await enforceDepartmentPatient(req, res, id))) {
    return;
  }
  const rows = await patientsRepo.listAssignedPhysicians(id);
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: physicianName(r.lastName, r.firstName),
      username: r.username,
      assignedAt: r.assignedAt.toISOString(),
    })),
  );
});

router.post("/patients/:id/physicians", requireAuth, async (req, res): Promise<void> => {
  if (!canAssignPhysicians(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to assign physician",
    });
    return;
  }
  const patientId = parseInt(String(req.params.id), 10);
  const physicianId = parseInt(String(req.body.physicianId), 10);
  if (!patientId || !physicianId) {
    res.status(400).json({ error: "patientId and physicianId are required" });
    return;
  }

  const patient = await patientsRepo.findPatientById(patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!(await enforceDepartmentPatient(req, res, patient.id, patient.patientHisId))) {
    return;
  }
  const physician = await usersRepo.findUserById(physicianId);
  if (!physician || physician.role !== "physician" || !physician.isActive) {
    res.status(404).json({ error: "Physician not found" });
    return;
  }

  const existingAssignment = await patientPhysiciansRepo.findAssignment(patientId, physicianId);
  if (existingAssignment) {
    res.status(409).json({ error: "Physician already assigned to this patient" });
    return;
  }

  await withTransaction(async (tx) => {
    await patientPhysiciansRepo.insertAssignment(
      { patientId, physicianId, assignedById: req.user!.userId },
      tx,
    );
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        patientHisId: patient.patientHisId,
        details: `Assigned physician: ${physicianName(physician.lastName, physician.firstName)}`,
      },
      tx,
    );
  });

  res.status(201).json({ message: "Physician assigned successfully" });
});

router.delete("/patients/:id/physicians/:physicianId", requireAuth, async (req, res): Promise<void> => {
  if (!canAssignPhysicians(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to remove physician assignment",
    });
    return;
  }
  const patientId = parseInt(String(req.params.id), 10);
  const physicianId = parseInt(String(req.params.physicianId), 10);
  if (!patientId || !physicianId) {
    res.status(400).json({ error: "Invalid IDs" });
    return;
  }

  const patient = await patientsRepo.findPatientById(patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  if (!(await enforceDepartmentPatient(req, res, patient.id, patient.patientHisId))) {
    return;
  }

  await withTransaction(async (tx) => {
    await patientPhysiciansRepo.deleteAssignment(patientId, physicianId, tx);
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        patientHisId: patient.patientHisId,
        details: `Removed physician assignment (physicianId: ${physicianId})`,
      },
      tx,
    );
  });
  res.json({ message: "Physician removed from patient" });
});

export default router;
