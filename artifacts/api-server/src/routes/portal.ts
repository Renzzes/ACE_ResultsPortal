import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, patientsTable, resultsTable } from "@workspace/db";
import {
  VerifyPatientAccessBody,
  GetPortalResultDownloadUrlParams,
} from "@workspace/api-zod";
import { requirePortalAuth } from "../middlewares/auth";
import { signPortalToken, signDownloadToken, verifyToken } from "../lib/auth";
import { getFilePath } from "../lib/storage";
import { logAudit } from "../lib/audit";
import fs from "fs";

const router = Router();

router.post("/portal/verify", async (req, res): Promise<void> => {
  const parsed = VerifyPatientAccessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { patientHisId, lastName, accessCode } = parsed.data;

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(
      and(
        eq(patientsTable.patientHisId, patientHisId),
        eq(patientsTable.accessCode, accessCode),
      )
    );

  if (!patient) {
    await logAudit({
      action: "access_denied",
      req,
      patientHisId,
      details: "Invalid patient portal access attempt",
    });
    res.status(401).json({ error: "Invalid credentials. Please check your Patient ID, Last Name, and Access Code." });
    return;
  }

  // Verify last name (case-insensitive)
  if (patient.lastName.toLowerCase() !== lastName.toLowerCase()) {
    await logAudit({
      action: "access_denied",
      req,
      patientHisId,
      details: "Last name mismatch on portal access",
    });
    res.status(401).json({ error: "Invalid credentials. Please check your Patient ID, Last Name, and Access Code." });
    return;
  }

  const sessionToken = signPortalToken({
    patientId: patient.id,
    patientHisId: patient.patientHisId,
  });

  res.json({
    sessionToken,
    patient: {
      id: patient.id,
      patientHisId: patient.patientHisId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      middleName: patient.middleName ?? null,
    },
  });
});

router.get("/portal/results", requirePortalAuth, async (req, res): Promise<void> => {
  const results = await db
    .select()
    .from(resultsTable)
    .where(
      and(
        eq(resultsTable.patientId, req.portalUser!.patientId),
        eq(resultsTable.status, "released"),
      )
    )
    .orderBy(resultsTable.uploadedAt);

  const formatted = results.map((r) => ({
    id: r.id,
    category: r.category,
    originalFileName: r.originalFileName,
    fileType: r.fileType,
    fileSizeBytes: r.fileSizeBytes ?? 0,
    status: r.status,
    remarks: r.remarks ?? null,
    uploadedAt: r.uploadedAt.toISOString(),
    dateReleased: r.dateReleased ? r.dateReleased.toISOString() : null,
  }));

  res.json(formatted);
});

router.get("/portal/results/:id/download", requirePortalAuth, async (req, res): Promise<void> => {
  const params = GetPortalResultDownloadUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db
    .select()
    .from(resultsTable)
    .where(
      and(
        eq(resultsTable.id, params.data.id),
        eq(resultsTable.patientId, req.portalUser!.patientId),
        eq(resultsTable.status, "released"),
      )
    );

  if (!result) {
    res.status(404).json({ error: "Result not found or not yet released" });
    return;
  }

  const token = signDownloadToken(result.id, "portal");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await logAudit({
    action: "download",
    req,
    patientHisId: req.portalUser!.patientHisId,
    resultId: result.id,
    details: "Patient downloaded result",
  });

  res.json({
    url: `/api/portal/file/${token}`,
    expiresAt,
  });
});

// Serve file for portal patients
router.get("/portal/file/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const payload = verifyToken(token);

  if (!payload || payload["type"] !== "download" || payload["forType"] !== "portal") {
    res.status(401).json({ error: "Invalid or expired download link" });
    return;
  }

  const resultId = payload["resultId"] as number;
  const [result] = await db
    .select()
    .from(resultsTable)
    .where(and(eq(resultsTable.id, resultId), eq(resultsTable.status, "released")));

  if (!result) {
    res.status(404).json({ error: "Result not found or not released" });
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
    `inline; filename="${encodeURIComponent(result.originalFileName)}"`,
  );
  res.setHeader("Cache-Control", "private, no-store");

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

router.post("/portal/logout", requirePortalAuth, async (req, res): Promise<void> => {
  await logAudit({
    action: "logout",
    req,
    patientHisId: req.portalUser!.patientHisId,
    details: "Patient portal logout",
  });
  res.json({ message: "Logged out successfully" });
});

export default router;
