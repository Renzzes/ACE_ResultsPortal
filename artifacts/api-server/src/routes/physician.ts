import { Router } from "express";
import { eq, ilike } from "drizzle-orm";
import { db, patientsTable, resultsTable } from "@workspace/db";
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

router.get("/physician/search", requireAuth, requireRole(...physicianRoles), async (req, res): Promise<void> => {
  const params = PhysicianSearchPatientQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { patientId } = params.data;

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(ilike(patientsTable.patientHisId, patientId));

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const resultCount = await db
    .select({ count: eq(resultsTable.patientId, patient.id) })
    .from(resultsTable)
    .where(eq(resultsTable.patientId, patient.id));

  await logAudit({
    action: "view",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "Physician searched patient",
  });

  res.json({
    id: patient.id,
    patientHisId: patient.patientHisId,
    firstName: patient.firstName,
    lastName: patient.lastName,
    middleName: patient.middleName ?? null,
    dateOfBirth: patient.dateOfBirth,
    resultCount: resultCount.length,
  });
});

router.get("/physician/patients/:id/results", requireAuth, requireRole(...physicianRoles), async (req, res): Promise<void> => {
  const params = ListPatientResultsPhysicianParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id));
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const results = await db
    .select()
    .from(resultsTable)
    .where(eq(resultsTable.patientId, params.data.id))
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

  const token = signDownloadToken(result.id, "physician");
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
  const payload = verifyToken(token);

  if (!payload || payload["type"] !== "download") {
    res.status(401).json({ error: "Invalid or expired download link" });
    return;
  }

  const resultId = payload["resultId"] as number;
  const [result] = await db.select().from(resultsTable).where(eq(resultsTable.id, resultId));

  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  const filePath = getFilePath(result.fileName);
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
    `attachment; filename="${encodeURIComponent(result.originalFileName)}"`,
  );

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

export default router;
