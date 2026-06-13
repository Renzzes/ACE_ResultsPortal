import { Router } from "express";
import { eq, ilike, and, or } from "drizzle-orm";
import { db, patientsTable, resultsTable, patientPhysiciansTable } from "@workspace/db";
import {
  PhysicianSearchPatientQueryParams,
  ListPatientResultsPhysicianParams,
  PhysicianGetResultDownloadUrlParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { signDownloadToken, verifyToken } from "../lib/auth";
import { getFilePath } from "../lib/storage";
import { logAudit } from "../lib/audit";
import fs from "fs";

const router = Router();

const physicianRoles = ["physician", "super_admin"];

// Search patient — by HIS ID or last name, restricted to assigned patients for physicians
router.get("/physician/search", requireAuth, requireRole(...physicianRoles), async (req, res): Promise<void> => {
  const params = PhysicianSearchPatientQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { q } = params.data as { q?: string };
  const term = q?.trim();

  if (!term) {
    res.status(400).json({ error: "Provide a search term" });
    return;
  }

  const isPhysician = req.user!.role === "physician";
  const physicianUserId = req.user!.userId;

  // Match either HIS ID or last name with a single search term
  const conditions = or(
    ilike(patientsTable.patientHisId, `%${term}%`),
    ilike(patientsTable.lastName, `%${term}%`),
  );

  let patients;

  if (isPhysician) {
    // Join with patient_physicians to restrict to assigned patients only
    patients = await db
      .select({ patient: patientsTable })
      .from(patientsTable)
      .innerJoin(
        patientPhysiciansTable,
        and(
          eq(patientPhysiciansTable.patientId, patientsTable.id),
          eq(patientPhysiciansTable.physicianId, physicianUserId),
        )
      )
      .where(conditions)
      .limit(20);
    patients = patients.map((r) => r.patient);
  } else {
    // super_admin can search all patients
    patients = await db
      .select()
      .from(patientsTable)
      .where(conditions)
      .limit(20);
  }

  if (patients.length === 0) {
    res.status(404).json({ error: "No matching patient found" });
    return;
  }

  // Exact HIS ID match takes precedence — collapse to single result
  const exact = patients.find((p) => p.patientHisId.toLowerCase() === term.toLowerCase());
  if (exact) {
    patients = [exact];
  }

  await logAudit({
    action: "view",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patients[0].patientHisId,
    details: "Physician searched patient",
  });

  // Return array if searching by last name (multiple possible), or first match for HIS ID
  const format = (patient: typeof patients[0]) => ({
    id: patient.id,
    patientHisId: patient.patientHisId,
    firstName: patient.firstName,
    lastName: patient.lastName,
    middleName: patient.middleName ?? null,
    dateOfBirth: patient.dateOfBirth,
    resultCount: 0, // filled below if single result
  });

  if (patients.length === 1) {
    const patient = patients[0];
    const resultRows = await db
      .select()
      .from(resultsTable)
      .where(
        isPhysician
          ? and(eq(resultsTable.patientId, patient.id), eq(resultsTable.status, "released"))
          : eq(resultsTable.patientId, patient.id)
      );

    res.json({ ...format(patient), resultCount: resultRows.length });
  } else {
    // Multiple patients — return array
    res.json(patients.map(format));
  }
});

// Patient results for physician — only released results
router.get("/physician/patients/:id/results", requireAuth, requireRole(...physicianRoles), async (req, res): Promise<void> => {
  const params = ListPatientResultsPhysicianParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const isPhysician = req.user!.role === "physician";
  const physicianUserId = req.user!.userId;

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id));
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  // Physicians can only see their assigned patients
  if (isPhysician) {
    const [assignment] = await db
      .select()
      .from(patientPhysiciansTable)
      .where(
        and(
          eq(patientPhysiciansTable.patientId, params.data.id),
          eq(patientPhysiciansTable.physicianId, physicianUserId)
        )
      );
    if (!assignment) {
      res.status(403).json({ error: "Patient is not assigned to you" });
      return;
    }
  }

  const whereClause = isPhysician
    ? and(eq(resultsTable.patientId, params.data.id), eq(resultsTable.status, "released"))
    : eq(resultsTable.patientId, params.data.id);

  const results = await db
    .select()
    .from(resultsTable)
    .where(whereClause)
    .orderBy(resultsTable.uploadedAt);

  await logAudit({
    action: "view",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "Physician viewed patient results",
  });

  const formatted = results.map((r) => ({
    id: r.id,
    patientId: r.patientId,
    patientHisId: patient.patientHisId,
    patientName: `${patient.lastName}, ${patient.firstName}`,
    category: r.category,
    fileName: r.fileName,
    originalFileName: r.originalFileName,
    fileType: r.fileType,
    fileSizeBytes: r.fileSizeBytes ?? 0,
    releaseOption: r.releaseOption,
    scheduledReleaseDate: r.scheduledReleaseDate ?? null,
    dateReleased: r.dateReleased ? r.dateReleased.toISOString() : null,
    status: r.status,
    remarks: r.remarks ?? null,
    uploadedById: r.uploadedById,
    uploadedByName: `Staff #${r.uploadedById}`,
    uploadedAt: r.uploadedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));

  res.json(formatted);
});

router.get("/physician/results/:id/download", requireAuth, requireRole(...physicianRoles), async (req, res): Promise<void> => {
  const params = PhysicianGetResultDownloadUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db.select().from(resultsTable).where(eq(resultsTable.id, params.data.id));
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  // Physicians can only download released results from assigned patients
  if (req.user!.role === "physician") {
    if (result.status !== "released") {
      res.status(403).json({ error: "Result is not released" });
      return;
    }
    const [assignment] = await db
      .select()
      .from(patientPhysiciansTable)
      .where(
        and(
          eq(patientPhysiciansTable.patientId, result.patientId),
          eq(patientPhysiciansTable.physicianId, req.user!.userId)
        )
      );
    if (!assignment) {
      res.status(403).json({ error: "Patient is not assigned to you" });
      return;
    }
  }

  const token = signDownloadToken(result.id, "physician", req.user!.userId);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

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
    expiresAt,
  });
});

router.get("/physician/file/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const { inline } = req.query as { inline?: string };
  const payload = verifyToken(token);

  // Enforce token type AND audience — a physician file link must be a physician-scoped download token
  if (!payload || payload["type"] !== "download" || payload["forType"] !== "physician") {
    res.status(401).json({ error: "Invalid or expired download link" });
    return;
  }

  const resultId = payload["resultId"] as number;
  const subjectId = payload["subjectId"] as number | undefined;
  const [result] = await db.select().from(resultsTable).where(eq(resultsTable.id, resultId));

  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  // Re-validate at serve time: result must still be released and still assigned to the token's physician
  if (result.status !== "released") {
    res.status(403).json({ error: "Result is not released" });
    return;
  }
  if (subjectId !== undefined) {
    const [assignment] = await db
      .select()
      .from(patientPhysiciansTable)
      .where(
        and(
          eq(patientPhysiciansTable.patientId, result.patientId),
          eq(patientPhysiciansTable.physicianId, subjectId)
        )
      );
    if (!assignment) {
      res.status(403).json({ error: "Patient is not assigned to you" });
      return;
    }
  }

  const filePath = getFilePath(result.fileName);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
  };

  const disposition = inline === "1" ? "inline" : "attachment";

  res.setHeader("Content-Type", mimeMap[result.fileType] ?? "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${encodeURIComponent(result.originalFileName)}"`,
  );

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

export default router;
