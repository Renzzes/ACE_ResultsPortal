import { Router } from "express";
import fs from "fs";
import {
  patientsRepo,
  patientPhysiciansRepo,
  prescriptionsRepo,
  resultPhysiciansRepo,
  resultsRepo,
  usersRepo,
  withTransaction,
} from "@workspace/db";
import {
  PhysicianSearchPatientQueryParams,
  ListPatientResultsPhysicianParams,
  PhysicianGetResultDownloadUrlParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { signDownloadToken, verifyToken } from "../lib/auth";
import { getFilePath } from "../lib/storage";
import { denyAccess, logAudit } from "../lib/audit";
import { formatResult } from "../lib/formatters";
import { canAccessResult } from "../lib/result-access";
import { loadReviewExtras } from "../lib/result-review";
import {
  assertPhysicianMayAccessPatient,
  parsePrescriptionCreateItems,
  trimNullable,
} from "../lib/prescription-access";
import { formatPrescription } from "../lib/format-prescription";
import { notifyPatientPrescriptionCreated } from "../lib/notify-prescription-created";

const router = Router();

const physicianRoles = ["physician", "super_admin"] as const;
const PRESCRIPTION_SCHEMA_MSG =
  "Prescriptions schema is not installed. Run docs/migration/sql/011_create_prescriptions.sql against ACE_ResultsPortal.";

router.get("/physician/search", requireAuth, requireRole(...physicianRoles), async (req, res): Promise<void> => {
  const params = PhysicianSearchPatientQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const term = (params.data as { q?: string }).q?.trim();
  if (!term) {
    res.status(400).json({ error: "Provide a search term" });
    return;
  }

  const isPhysician = req.user!.role === "physician";
  let patients = await patientsRepo.searchPatientsByTerm(
    term,
    isPhysician ? req.user!.userId : undefined,
  );

  if (patients.length === 0) {
    res.status(404).json({ error: "No matching patient found" });
    return;
  }

  const exact = patients.find((p) => p.patientHisId.toLowerCase() === term.toLowerCase());
  if (exact) patients = [exact];

  await logAudit({
    action: "view",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patients[0].patientHisId,
    details: "Physician searched patient",
  });

  const format = (patient: (typeof patients)[0], resultCount = 0) => ({
    id: patient.id,
    patientHisId: patient.patientHisId,
    firstName: patient.firstName,
    lastName: patient.lastName,
    middleName: patient.middleName ?? null,
    dateOfBirth: patient.dateOfBirth,
    resultCount,
  });

  if (patients.length === 1) {
    const patient = patients[0];
    const resultRows = await resultsRepo.listResultsForPatient(patient.id);
    const visible = [];
    for (const row of resultRows) {
      if (await canAccessResult(req.user!, row)) visible.push(row);
    }
    res.json(format(patient, visible.length));
    return;
  }

  res.json(patients.map((p) => format(p)));
});

router.get(
  "/physician/patients/:id/results",
  requireAuth,
  requireRole(...physicianRoles),
  async (req, res): Promise<void> => {
    const params = ListPatientResultsPhysicianParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const patient = await patientsRepo.findPatientById(params.data.id);
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    const isPhysician = req.user!.role === "physician";
    if (isPhysician) {
      const assignment = await patientPhysiciansRepo.findAssignment(params.data.id, req.user!.userId);
      if (!assignment) {
        const candidateResults = await resultsRepo.listResultsForPatient(params.data.id);
        let hasPrivateReview = false;
        for (const row of candidateResults) {
          if (await resultPhysiciansRepo.findAssignment(row.id, req.user!.userId)) {
            hasPrivateReview = true;
            break;
          }
        }
        if (!hasPrivateReview) {
          await denyAccess(req, res, {
            error: "Patient is not assigned to you",
            details: "Unauthorized attempt to access unassigned patient results",
            patientHisId: patient.patientHisId,
          });
          return;
        }
      }
    }

    const results = await resultsRepo.listResultsForPatient(params.data.id);
    const visible = [];
    for (const row of results) {
      if (await canAccessResult(req.user!, row)) visible.push(row);
    }

    await logAudit({
      action: "view",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      patientHisId: patient.patientHisId,
      details: "Physician viewed patient results",
    });

    res.json(
      await Promise.all(visible.map(async (r) =>
        formatResult(r, {
          patientHisId: patient.patientHisId,
          patientName: `${patient.lastName}, ${patient.firstName}`,
          ...(req.user!.role === "physician"
            ? await loadReviewExtras(r.id, req.user!)
            : {}),
        }),
      )),
    );
  },
);

router.get(
  "/physician/results/:id/download",
  requireAuth,
  requireRole(...physicianRoles),
  async (req, res): Promise<void> => {
    const params = PhysicianGetResultDownloadUrlParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const result = await resultsRepo.findResultById(params.data.id);
    if (!result) {
      res.status(404).json({ error: "Result not found" });
      return;
    }

    if (!(await canAccessResult(req.user!, result))) {
      await denyAccess(req, res, {
        error: "Not authorized to download this result",
        details: "Unauthorized attempt to download result",
        resultId: result.id,
      });
      return;
    }

    const token = signDownloadToken({
      resultId: result.id,
      forType: "physician",
      subjectId: req.user!.userId,
    });
    await logAudit({
      action: "download",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      resultId: result.id,
      details: "Physician downloaded result",
    });
    res.json({
      url: `/api/physician/file/${token}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  },
);

router.get("/physician/file/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const { inline } = req.query as { inline?: string };
  const payload = verifyToken(token);
  if (!payload || payload["type"] !== "download" || payload["forType"] !== "physician") {
    res.status(401).json({ error: "Invalid or expired download link" });
    return;
  }

  const resultId = payload["resultId"] as number;
  const subjectId = payload["subjectId"] as number | undefined;
  const result = await resultsRepo.findResultById(resultId);
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  if (subjectId === undefined) {
    res.status(401).json({ error: "Invalid download token" });
    return;
  }

  const user = await usersRepo.findUserById(subjectId);
  if (!user || !user.isActive) {
    await denyAccess(req, res, {
      error: "Not authorized to download this result",
      details: "Unauthorized attempt to stream result via token (inactive or missing user)",
      userId: subjectId,
      resultId: result.id,
    });
    return;
  }

  if (!(await canAccessResult({ userId: user.id, username: user.username, role: user.role }, result))) {
    await denyAccess(req, res, {
      error: "Not authorized to download this result",
      details: "Unauthorized attempt to stream result via token",
      userId: subjectId,
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
  const disposition = inline === "1" ? "inline" : "attachment";
  res.setHeader("Content-Type", mimeMap[result.fileType] ?? "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${encodeURIComponent(result.originalFileName)}"`,
  );
  fs.createReadStream(filePath).pipe(res);
});

router.get(
  "/physician/patients/:patientId/prescriptions",
  requireAuth,
  requireRole("physician"),
  async (req, res): Promise<void> => {
    const patientId = parseInt(String(req.params.patientId), 10);
    if (!Number.isFinite(patientId) || patientId <= 0) {
      res.status(400).json({ error: "Invalid patientId" });
      return;
    }

    const access = await assertPhysicianMayAccessPatient(req.user!, patientId);
    if (!access.ok) {
      if (access.reason === "not_found") {
        res.status(404).json({ error: "Patient not found" });
        return;
      }
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to list prescriptions for unassigned patient",
      });
      return;
    }

    if (!(await prescriptionsRepo.schemaReady())) {
      res.status(503).json({ error: PRESCRIPTION_SCHEMA_MSG });
      return;
    }

    const rows = await prescriptionsRepo.listPrescriptionsForPatient(patientId);
    await logAudit({
      action: "view",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      details: `prescription_list patientId=${patientId}`,
    });
    res.json(rows.map(formatPrescription));
  },
);

router.post(
  "/physician/patients/:patientId/prescriptions",
  requireAuth,
  requireRole("physician"),
  async (req, res): Promise<void> => {
    const patientId = parseInt(String(req.params.patientId), 10);
    if (!Number.isFinite(patientId) || patientId <= 0) {
      res.status(400).json({ error: "Invalid patientId" });
      return;
    }

    const access = await assertPhysicianMayAccessPatient(req.user!, patientId);
    if (!access.ok) {
      if (access.reason === "not_found") {
        res.status(404).json({ error: "Patient not found" });
        return;
      }
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to create prescription for unassigned patient",
      });
      return;
    }

    if (!(await prescriptionsRepo.schemaReady())) {
      res.status(503).json({ error: PRESCRIPTION_SCHEMA_MSG });
      return;
    }

    const parsed = parsePrescriptionCreateItems(req.body?.items);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const created = await withTransaction(async (tx) =>
      prescriptionsRepo.createPrescription(
        {
          patientId,
          physicianId: req.user!.userId,
          diagnosisOrIndication: trimNullable(req.body?.diagnosisOrIndication, 500),
          generalInstructions: trimNullable(req.body?.generalInstructions, 4000),
          notes: trimNullable(req.body?.notes, 4000),
          items: parsed.items,
        },
        tx,
      ),
    );

    await logAudit({
      action: "edit",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      details: `prescription_created id=${created.id}`,
    });

    void notifyPatientPrescriptionCreated({
      prescriptionId: created.id,
      patientId,
    }).catch(() => undefined);

    res.status(201).json(formatPrescription(created));
  },
);

export default router;
