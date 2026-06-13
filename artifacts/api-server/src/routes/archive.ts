import { Router } from "express";
import { eq, ilike, or, sql, and, desc } from "drizzle-orm";
import { db, resultsTable, patientsTable } from "@workspace/db";
import {
  ListArchivedResultsQueryParams,
  RestoreArchivedResultParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();

router.get("/archive", requireAuth, async (req, res): Promise<void> => {
  const params = ListArchivedResultsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { search, page = 1, limit = 20 } = params.data;

  const baseWhere = eq(resultsTable.status, "archived");

  let where = baseWhere;
  if (search) {
    const patientMatches = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(
        or(
          ilike(patientsTable.patientHisId, `%${search}%`),
          ilike(patientsTable.lastName, `%${search}%`),
          ilike(patientsTable.firstName, `%${search}%`),
        )
      );
    const patientIds = patientMatches.map((p) => p.id);

    if (patientIds.length > 0) {
      where = and(
        baseWhere,
        sql`${resultsTable.patientId} = ANY(ARRAY[${sql.join(patientIds.map((id) => sql`${id}`), sql`, `)}]::int[])`,
      ) as typeof baseWhere;
    } else {
      where = and(baseWhere, sql`false`) as typeof baseWhere;
    }
  }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resultsTable)
    .where(where);

  const archived = await db
    .select()
    .from(resultsTable)
    .where(where)
    .limit(limit)
    .offset((page - 1) * limit)
    .orderBy(desc(resultsTable.updatedAt));

  const formatted = await Promise.all(
    archived.map(async (r) => {
      const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, r.patientId));
      return {
        id: r.id,
        patientId: r.patientId,
        patientHisId: patient?.patientHisId ?? "",
        patientName: patient ? `${patient.lastName}, ${patient.firstName}` : "",
        category: r.category,
        originalFileName: r.originalFileName,
        fileType: r.fileType,
        archivedAt: r.updatedAt.toISOString(),
        originalUploadedAt: r.uploadedAt.toISOString(),
        remarks: r.remarks ?? null,
      };
    })
  );

  res.json({
    data: formatted,
    total: countResult?.count ?? 0,
    page,
    limit,
  });
});

router.post("/archive/:id/restore", requireAuth, async (req, res): Promise<void> => {
  const params = RestoreArchivedResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(resultsTable)
    .where(and(eq(resultsTable.id, params.data.id), eq(resultsTable.status, "archived")));

  if (!existing) {
    res.status(404).json({ error: "Archived result not found" });
    return;
  }

  const [result] = await db
    .update(resultsTable)
    .set({ status: "pending" })
    .where(eq(resultsTable.id, params.data.id))
    .returning();

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, result.patientId));

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    patientHisId: patient?.patientHisId,
    resultId: result.id,
    details: "Restored archived result",
  });

  const formatted = {
    id: result.id,
    patientId: result.patientId,
    patientHisId: patient?.patientHisId ?? "",
    patientName: patient ? `${patient.lastName}, ${patient.firstName}` : "",
    category: result.category,
    fileName: result.fileName,
    originalFileName: result.originalFileName,
    fileType: result.fileType,
    fileSizeBytes: result.fileSizeBytes ?? 0,
    releaseOption: result.releaseOption,
    scheduledReleaseDate: result.scheduledReleaseDate ?? null,
    dateReleased: result.dateReleased ? result.dateReleased.toISOString() : null,
    status: result.status,
    remarks: result.remarks ?? null,
    uploadedById: result.uploadedById,
    uploadedByName: `Staff #${result.uploadedById}`,
    uploadedAt: result.uploadedAt.toISOString(),
    createdAt: result.createdAt.toISOString(),
  };

  res.json(formatted);
});

export default router;
