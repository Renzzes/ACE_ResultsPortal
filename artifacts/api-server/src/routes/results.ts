import { Router } from "express";
import { eq, sql, and, gte, lte, desc, inArray } from "drizzle-orm";
import { db, resultsTable, patientsTable, usersTable, patientPhysiciansTable } from "@workspace/db";
import {
  ListResultsQueryParams,
  GetResultParams,
  UpdateResultParams,
  DeleteResultParams,
  ReleaseResultParams,
  GetResultDownloadUrlParams,
  UpdateResultBody,
  ReleaseResultBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { upload, getFileType, getFilePath, deleteFile } from "../lib/storage";
import { signDownloadToken, verifyToken } from "../lib/auth";
import { logAudit } from "../lib/audit";
import path from "path";
import fs from "fs";

const router = Router();

// Categories visible per role (empty = all)
const DEPT_CATEGORIES: Record<string, string[]> = {
  laboratory: ["laboratory"],
  radiology: ["radiology", "ultrasound", "ct_scan", "mri", "ecg", "echo_2d", "rehabilitation", "other"],
};

/** Build extra WHERE conditions based on the caller's role. Returns null → no results allowed. */
async function buildRoleConditions(
  req: import("express").Request
): Promise<ReturnType<typeof eq>[] | null> {
  const role = req.user!.role;
  const extra: ReturnType<typeof eq>[] = [];

  if (DEPT_CATEGORIES[role]) {
    extra.push(inArray(resultsTable.category, DEPT_CATEGORIES[role] as any) as any);
  } else if (role === "physician") {
    const rows = await db
      .select({ patientId: patientPhysiciansTable.patientId })
      .from(patientPhysiciansTable)
      .where(eq(patientPhysiciansTable.physicianId, req.user!.userId));
    const ids = rows.map((r) => r.patientId);
    if (ids.length === 0) return null;
    extra.push(inArray(resultsTable.patientId, ids) as any);
    extra.push(eq(resultsTable.status, "released") as any);
  }

  return extra;
}

/** Returns true if the caller is allowed to access this specific result. */
async function canAccessResult(
  req: import("express").Request,
  result: typeof resultsTable.$inferSelect
): Promise<boolean> {
  const role = req.user!.role;
  if (role === "super_admin" || role === "medical_records") return true;
  if (DEPT_CATEGORIES[role]) return DEPT_CATEGORIES[role].includes(result.category);
  if (role === "physician") {
    if (result.status !== "released") return false;
    const [row] = await db
      .select()
      .from(patientPhysiciansTable)
      .where(
        and(
          eq(patientPhysiciansTable.patientId, result.patientId),
          eq(patientPhysiciansTable.physicianId, req.user!.userId)
        )
      );
    return !!row;
  }
  return false;
}

async function formatResult(r: typeof resultsTable.$inferSelect) {
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, r.patientId));
  const [uploader] = await db.select().from(usersTable).where(eq(usersTable.id, r.uploadedById));

  return {
    id: r.id,
    patientId: r.patientId,
    patientHisId: patient?.patientHisId ?? "",
    patientName: patient ? `${patient.lastName}, ${patient.firstName}` : "",
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
    uploadedByName: uploader ? `${uploader.firstName} ${uploader.lastName}` : `User #${r.uploadedById}`,
    uploadedAt: r.uploadedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

// ─── List results ─────────────────────────────────────────────────────────
router.get("/results", requireAuth, async (req, res): Promise<void> => {
  const params = ListResultsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { patientId, category, status, uploadedBy, dateFrom, dateTo, page = 1, limit = 20 } = params.data;

  const roleConditions = await buildRoleConditions(req);
  if (roleConditions === null) {
    res.json({ data: [], total: 0, page, limit });
    return;
  }

  const conditions = [...roleConditions];
  if (patientId) conditions.push(eq(resultsTable.patientId, patientId) as any);
  if (category) conditions.push(eq(resultsTable.category, category as any) as any);
  if (status) conditions.push(eq(resultsTable.status, status as any) as any);
  if (uploadedBy) conditions.push(eq(resultsTable.uploadedById, uploadedBy) as any);
  if (dateFrom) conditions.push(gte(resultsTable.uploadedAt, new Date(dateFrom)) as any);
  if (dateTo) conditions.push(lte(resultsTable.uploadedAt, new Date(dateTo)) as any);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resultsTable)
    .where(where);

  const results = await db
    .select()
    .from(resultsTable)
    .where(where)
    .limit(limit)
    .offset((page - 1) * limit)
    .orderBy(desc(resultsTable.uploadedAt));

  const formatted = await Promise.all(results.map(formatResult));

  res.json({
    data: formatted,
    total: countResult?.count ?? 0,
    page,
    limit,
  });
});

// ─── Upload ───────────────────────────────────────────────────────────────
router.post("/results/upload", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const patientId = parseInt(String(req.body.patientId), 10);
  const category = req.body.category;
  const releaseOption = req.body.releaseOption;
  const scheduledReleaseDate = req.body.scheduledReleaseDate || null;
  const remarks = req.body.remarks || null;

  if (!patientId || !category || !releaseOption) {
    res.status(400).json({ error: "Missing required fields: patientId, category, releaseOption" });
    return;
  }

  // Department check: lab staff can only upload lab results, radiology only their categories
  const role = req.user!.role;
  if (DEPT_CATEGORIES[role] && !DEPT_CATEGORIES[role].includes(category)) {
    res.status(403).json({ error: `Your department (${role}) is not authorized to upload ${category} results` });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  if (!patient) {
    res.status(400).json({ error: "Patient not found" });
    return;
  }

  const fileType = getFileType(req.file.mimetype);
  if (!fileType) {
    res.status(400).json({ error: "Invalid file type" });
    return;
  }

  let status: "pending" | "released" = "pending";
  let dateReleased: Date | null = null;
  if (releaseOption === "immediate") {
    status = "released";
    dateReleased = new Date();
  }

  const [result] = await db.insert(resultsTable).values({
    patientId,
    category: category as typeof resultsTable.$inferSelect["category"],
    fileName: req.file.filename,
    originalFileName: req.file.originalname,
    fileType,
    fileSizeBytes: req.file.size,
    releaseOption: releaseOption as typeof resultsTable.$inferSelect["releaseOption"],
    scheduledReleaseDate: scheduledReleaseDate,
    dateReleased: dateReleased ?? undefined,
    status,
    remarks,
    uploadedById: req.user!.userId,
  }).returning();

  await logAudit({
    action: "upload",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    resultId: result.id,
    details: `Uploaded ${req.file.originalname} (${category})`,
  });

  res.status(201).json(await formatResult(result));
});

// ─── Get single result ────────────────────────────────────────────────────
router.get("/results/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db.select().from(resultsTable).where(eq(resultsTable.id, params.data.id));
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  if (!(await canAccessResult(req, result))) {
    res.status(403).json({ error: "Not authorized to access this result" });
    return;
  }

  await logAudit({
    action: "view",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: result.id,
    details: "Viewed result",
  });

  res.json(await formatResult(result));
});

// ─── Update result ────────────────────────────────────────────────────────
router.patch("/results/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(resultsTable).where(eq(resultsTable.id, params.data.id));
  if (!existing || !(await canAccessResult(req, existing))) {
    res.status(403).json({ error: "Not authorized to modify this result" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.category) updates.category = parsed.data.category;
  if (parsed.data.releaseOption) updates.releaseOption = parsed.data.releaseOption;
  if (parsed.data.scheduledReleaseDate !== undefined) updates.scheduledReleaseDate = parsed.data.scheduledReleaseDate;
  if (parsed.data.remarks !== undefined) updates.remarks = parsed.data.remarks;
  if (parsed.data.status) updates.status = parsed.data.status;

  const [result] = await db
    .update(resultsTable)
    .set(updates)
    .where(eq(resultsTable.id, params.data.id))
    .returning();

  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: result.id,
    details: "Updated result metadata",
  });

  res.json(await formatResult(result));
});

// ─── Delete result ────────────────────────────────────────────────────────
router.delete("/results/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db.select().from(resultsTable).where(eq(resultsTable.id, params.data.id));
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  if (!(await canAccessResult(req, result))) {
    res.status(403).json({ error: "Not authorized to delete this result" });
    return;
  }

  await db.delete(resultsTable).where(eq(resultsTable.id, params.data.id));
  deleteFile(result.fileName);

  await logAudit({
    action: "delete",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: result.id,
    details: `Deleted result: ${result.originalFileName}`,
  });

  res.json({ message: "Result deleted successfully" });
});

// ─── Release result ───────────────────────────────────────────────────────
router.post("/results/:id/release", requireAuth, async (req, res): Promise<void> => {
  const params = ReleaseResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = ReleaseResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(resultsTable).where(eq(resultsTable.id, params.data.id));
  if (!existing || !(await canAccessResult(req, existing))) {
    res.status(403).json({ error: "Not authorized to release this result" });
    return;
  }

  const updates: Record<string, unknown> = { releaseOption: parsed.data.releaseOption };

  if (parsed.data.releaseOption === "immediate") {
    updates.status = "released";
    updates.dateReleased = new Date();
  } else if (parsed.data.scheduledReleaseDate) {
    updates.scheduledReleaseDate = parsed.data.scheduledReleaseDate;
  }

  const [result] = await db
    .update(resultsTable)
    .set(updates)
    .where(eq(resultsTable.id, params.data.id))
    .returning();

  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: result.id,
    details: `Released result with option: ${parsed.data.releaseOption}`,
  });

  res.json(await formatResult(result));
});

// ─── Download URL ─────────────────────────────────────────────────────────
router.get("/results/:id/download", requireAuth, async (req, res): Promise<void> => {
  const params = GetResultDownloadUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db.select().from(resultsTable).where(eq(resultsTable.id, params.data.id));
  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  if (!(await canAccessResult(req, result))) {
    res.status(403).json({ error: "Not authorized to download this result" });
    return;
  }

  const token = signDownloadToken(result.id, "staff");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await logAudit({
    action: "download",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    resultId: result.id,
    details: "Generated download link",
  });

  res.json({ url: `/api/results/file/${token}`, expiresAt });
});

// ─── Serve file via signed token ──────────────────────────────────────────
router.get("/results/file/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const payload = verifyToken(token);

  if (!payload || payload["type"] !== "download" || payload["forType"] !== "staff") {
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
    res.status(404).json({ error: "File not found on disk" });
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
