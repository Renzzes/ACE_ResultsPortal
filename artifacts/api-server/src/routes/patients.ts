import { Router } from "express";
import { eq, ilike, or, sql, and, desc } from "drizzle-orm";
import { db, patientsTable, resultsTable } from "@workspace/db";
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
import { requireAuth } from "../middlewares/auth";
import { generateAccessCode } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router = Router();

function formatPatient(p: typeof patientsTable.$inferSelect, resultCount = 0) {
  return {
    id: p.id,
    patientHisId: p.patientHisId,
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName ?? null,
    dateOfBirth: p.dateOfBirth,
    mobileNumber: p.mobileNumber ?? null,
    email: p.email ?? null,
    accessCode: p.accessCode,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    resultCount,
  };
}

router.get("/patients", requireAuth, async (req, res): Promise<void> => {
  const params = ListPatientsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { search, page = 1, limit = 20 } = params.data;

  const conditions = [];
  if (search) {
    conditions.push(
      or(
        ilike(patientsTable.patientHisId, `%${search}%`),
        ilike(patientsTable.lastName, `%${search}%`),
        ilike(patientsTable.firstName, `%${search}%`),
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patientsTable)
    .where(where);

  const patients = await db
    .select()
    .from(patientsTable)
    .where(where)
    .limit(limit)
    .offset((page - 1) * limit)
    .orderBy(desc(patientsTable.createdAt));

  const patientIds = patients.map((p) => p.id);
  const resultCounts: Record<number, number> = {};
  if (patientIds.length > 0) {
    const counts = await db
      .select({
        patientId: resultsTable.patientId,
        count: sql<number>`count(*)::int`,
      })
      .from(resultsTable)
      .where(sql`${resultsTable.patientId} = ANY(ARRAY[${sql.join(patientIds.map((id) => sql`${id}`), sql`, `)}]::int[])`)
      .groupBy(resultsTable.patientId);
    counts.forEach(({ patientId, count }) => {
      resultCounts[patientId] = count;
    });
  }

  res.json({
    data: patients.map((p) => formatPatient(p, resultCounts[p.id] ?? 0)),
    total: countResult?.count ?? 0,
    page,
    limit,
  });
});

router.post("/patients", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.patientHisId, parsed.data.patientHisId));
  if (existing.length > 0) {
    const p = existing[0];
    res.status(409).json({
      error: "Patient ID already exists in the system",
      existingPatient: {
        id: p.id,
        patientHisId: p.patientHisId,
        lastName: p.lastName,
        firstName: p.firstName,
      },
    });
    return;
  }

  let accessCode = generateAccessCode();
  for (let i = 0; i < 10; i++) {
    const dup = await db.select().from(patientsTable).where(eq(patientsTable.accessCode, accessCode));
    if (dup.length === 0) break;
    accessCode = generateAccessCode();
  }

  const [patient] = await db.insert(patientsTable).values({
    patientHisId: parsed.data.patientHisId,
    lastName: parsed.data.lastName,
    firstName: parsed.data.firstName,
    middleName: parsed.data.middleName ?? null,
    dateOfBirth: parsed.data.dateOfBirth,
    mobileNumber: parsed.data.mobileNumber ?? null,
    email: parsed.data.email ?? null,
    accessCode,
    createdById: req.user!.userId,
  }).returning();

  await logAudit({
    action: "upload",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "Created patient record",
  });

  res.status(201).json(formatPatient(patient, 0));
});

router.get("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id));
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resultsTable)
    .where(eq(resultsTable.patientId, patient.id));

  res.json(formatPatient(patient, countResult?.count ?? 0));
});

router.patch("/patients/:id", requireAuth, async (req, res): Promise<void> => {
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

  const updates: Record<string, unknown> = {};
  if (parsed.data.lastName) updates.lastName = parsed.data.lastName;
  if (parsed.data.firstName) updates.firstName = parsed.data.firstName;
  if (parsed.data.middleName !== undefined) updates.middleName = parsed.data.middleName;
  if (parsed.data.dateOfBirth) updates.dateOfBirth = parsed.data.dateOfBirth;
  if (parsed.data.mobileNumber !== undefined) updates.mobileNumber = parsed.data.mobileNumber;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;

  const [patient] = await db
    .update(patientsTable)
    .set(updates)
    .where(eq(patientsTable.id, params.data.id))
    .returning();

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

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resultsTable)
    .where(eq(resultsTable.patientId, patient.id));

  res.json(formatPatient(patient, countResult?.count ?? 0));
});

router.delete("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeletePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [patient] = await db
    .delete(patientsTable)
    .where(eq(patientsTable.id, params.data.id))
    .returning();

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  await logAudit({
    action: "delete",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "Deleted patient record",
  });

  res.json({ message: "Patient record deleted successfully" });
});

router.post("/patients/:id/regenerate-access-code", requireAuth, async (req, res): Promise<void> => {
  const params = RegenerateAccessCodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  let accessCode = generateAccessCode();
  for (let i = 0; i < 10; i++) {
    const dup = await db.select().from(patientsTable).where(eq(patientsTable.accessCode, accessCode));
    if (dup.length === 0) break;
    accessCode = generateAccessCode();
  }

  const [patient] = await db
    .update(patientsTable)
    .set({ accessCode })
    .where(eq(patientsTable.id, params.data.id))
    .returning();

  await logAudit({
    action: "access_code_regen",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "Access code regenerated",
  });

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resultsTable)
    .where(eq(resultsTable.patientId, patient.id));

  res.json(formatPatient(patient, countResult?.count ?? 0));
});

router.get("/patients/:id/results", requireAuth, async (req, res): Promise<void> => {
  const params = ListPatientResultsStaffParams.safeParse(req.params);
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
    .orderBy(desc(resultsTable.uploadedAt));

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

export default router;
