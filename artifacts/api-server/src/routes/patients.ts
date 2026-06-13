import { Router } from "express";
import { eq, ilike, or, sql, and, desc, inArray } from "drizzle-orm";
import { db, patientsTable, resultsTable, usersTable, patientPhysiciansTable } from "@workspace/db";
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

// Categories each role is allowed to see in patient result lists
const DEPT_CATEGORIES: Record<string, string[]> = {
  laboratory: ["laboratory"],
  radiology: ["radiology", "ultrasound", "ct_scan", "mri", "ecg", "echo_2d", "rehabilitation", "other"],
};

function formatPatient(
  p: typeof patientsTable.$inferSelect,
  resultCount = 0,
  assignedPhysicians: Array<{ id: number; name: string }> = []
) {
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
    assignedPhysicians,
  };
}

async function getAssignedPatientIds(physicianId: number): Promise<number[]> {
  const rows = await db
    .select({ patientId: patientPhysiciansTable.patientId })
    .from(patientPhysiciansTable)
    .where(eq(patientPhysiciansTable.physicianId, physicianId));
  return rows.map((r) => r.patientId);
}

router.get("/patients", requireAuth, async (req, res): Promise<void> => {
  const params = ListPatientsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { search, page = 1, limit = 20 } = params.data;
  const role = req.user!.role;
  const conditions = [];

  // Physician: only their assigned patients
  if (role === "physician") {
    const assignedIds = await getAssignedPatientIds(req.user!.userId);
    if (assignedIds.length === 0) {
      res.json({ data: [], total: 0, page, limit });
      return;
    }
    conditions.push(inArray(patientsTable.id, assignedIds));
  }

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

  // Optionally assign a physician at creation time
  const physicianId = req.body.physicianId ? parseInt(String(req.body.physicianId), 10) : null;
  if (physicianId) {
    const [physician] = await db.select().from(usersTable).where(
      and(eq(usersTable.id, physicianId), eq(usersTable.role, "physician"))
    );
    if (physician) {
      await db.insert(patientPhysiciansTable).values({
        patientId: patient.id,
        physicianId: physician.id,
        assignedById: req.user!.userId,
      });
    }
  }

  await logAudit({
    action: "upload",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: "Created patient record",
  });

  res.status(201).json({
    ...formatPatient(patient, 0),
    accessCode: patient.accessCode,
  });
});

router.get("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const role = req.user!.role;

  // Physician: only their assigned patients
  if (role === "physician") {
    const assignedIds = await getAssignedPatientIds(req.user!.userId);
    if (!assignedIds.includes(params.data.id)) {
      res.status(403).json({ error: "Not authorized to view this patient" });
      return;
    }
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

  // Fetch assigned physicians
  const physicianRows = await db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(patientPhysiciansTable)
    .innerJoin(usersTable, eq(patientPhysiciansTable.physicianId, usersTable.id))
    .where(eq(patientPhysiciansTable.patientId, patient.id));

  const assignedPhysicians = physicianRows.map((r) => ({
    id: r.id,
    name: `Dr. ${r.lastName}, ${r.firstName}`,
  }));

  res.json(formatPatient(patient, countResult?.count ?? 0, assignedPhysicians));
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

  const role = req.user!.role;

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id));
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  // Physician: must be assigned to this patient, and only sees released results
  if (role === "physician") {
    const [assignment] = await db
      .select()
      .from(patientPhysiciansTable)
      .where(
        and(
          eq(patientPhysiciansTable.patientId, params.data.id),
          eq(patientPhysiciansTable.physicianId, req.user!.userId)
        )
      );
    if (!assignment) {
      res.status(403).json({ error: "Not authorized to view this patient's results" });
      return;
    }
  }

  // Department-scoped category filter
  const conditions: ReturnType<typeof eq>[] = [eq(resultsTable.patientId, params.data.id) as any];

  if (role === "physician") {
    conditions.push(eq(resultsTable.status, "released") as any);
  } else if (DEPT_CATEGORIES[role]) {
    const cats = DEPT_CATEGORIES[role] as any[];
    conditions.push(inArray(resultsTable.category, cats) as any);
  }

  const results = await db
    .select()
    .from(resultsTable)
    .where(and(...conditions))
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

// ─── Physician assignment endpoints ───────────────────────────────────────

router.get("/patients/:id/physicians", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id) { res.status(400).json({ error: "Invalid patient ID" }); return; }

  const rows = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      username: usersTable.username,
      assignedAt: patientPhysiciansTable.assignedAt,
    })
    .from(patientPhysiciansTable)
    .innerJoin(usersTable, eq(patientPhysiciansTable.physicianId, usersTable.id))
    .where(eq(patientPhysiciansTable.patientId, id));

  res.json(rows.map((r) => ({
    id: r.id,
    name: `Dr. ${r.lastName}, ${r.firstName}`,
    username: r.username,
    assignedAt: r.assignedAt.toISOString(),
  })));
});

router.post("/patients/:id/physicians", requireAuth, async (req, res): Promise<void> => {
  const patientId = parseInt(String(req.params.id), 10);
  const physicianId = parseInt(String(req.body.physicianId), 10);

  if (!patientId || !physicianId) {
    res.status(400).json({ error: "patientId and physicianId are required" });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

  const [physician] = await db.select().from(usersTable).where(
    and(eq(usersTable.id, physicianId), eq(usersTable.role, "physician"))
  );
  if (!physician) { res.status(404).json({ error: "Physician not found" }); return; }

  // Prevent duplicate assignments
  const [existing] = await db
    .select()
    .from(patientPhysiciansTable)
    .where(
      and(
        eq(patientPhysiciansTable.patientId, patientId),
        eq(patientPhysiciansTable.physicianId, physicianId)
      )
    );
  if (existing) {
    res.status(409).json({ error: "Physician already assigned to this patient" });
    return;
  }

  await db.insert(patientPhysiciansTable).values({
    patientId,
    physicianId,
    assignedById: req.user!.userId,
  });

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: `Assigned physician: Dr. ${physician.lastName}, ${physician.firstName}`,
  });

  res.status(201).json({ message: "Physician assigned successfully" });
});

router.delete("/patients/:id/physicians/:physicianId", requireAuth, async (req, res): Promise<void> => {
  const patientId = parseInt(String(req.params.id), 10);
  const physicianId = parseInt(String(req.params.physicianId), 10);

  if (!patientId || !physicianId) {
    res.status(400).json({ error: "Invalid IDs" });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

  await db
    .delete(patientPhysiciansTable)
    .where(
      and(
        eq(patientPhysiciansTable.patientId, patientId),
        eq(patientPhysiciansTable.physicianId, physicianId)
      )
    );

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient.patientHisId,
    details: `Removed physician assignment (physicianId: ${physicianId})`,
  });

  res.json({ message: "Physician removed from patient" });
});

export default router;
