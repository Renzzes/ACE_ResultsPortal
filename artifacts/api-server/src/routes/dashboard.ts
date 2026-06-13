import { Router } from "express";
import { sql, eq, gte, desc } from "drizzle-orm";
import { db, usersTable, patientsTable, resultsTable, auditLogsTable } from "@workspace/db";
import { GetRecentActivityQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router = Router();

router.get("/dashboard/stats", requireAuth, async (req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [[patientCount], [resultStats], [userStats], [uploadsToday], [uploadsMonth]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(patientsTable),
    db.select({
      total: sql<number>`count(*)::int`,
      released: sql<number>`count(*) filter (where status = 'released')::int`,
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
    }).from(resultsTable),
    db.select({
      totalStaff: sql<number>`count(*) filter (where role != 'physician')::int`,
      totalPhysicians: sql<number>`count(*) filter (where role = 'physician')::int`,
    }).from(usersTable),
    db.select({ count: sql<number>`count(*)::int` })
      .from(resultsTable)
      .where(gte(resultsTable.uploadedAt, today)),
    db.select({ count: sql<number>`count(*)::int` })
      .from(resultsTable)
      .where(gte(resultsTable.uploadedAt, firstOfMonth)),
  ]);

  // Count downloads from audit logs
  const [downloadCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.action, "download"));

  res.json({
    totalPatients: patientCount?.count ?? 0,
    totalResults: resultStats?.total ?? 0,
    totalReleased: resultStats?.released ?? 0,
    totalPending: resultStats?.pending ?? 0,
    totalDownloads: downloadCount?.count ?? 0,
    totalStaffUsers: userStats?.totalStaff ?? 0,
    totalPhysicians: userStats?.totalPhysicians ?? 0,
    uploadsToday: uploadsToday?.count ?? 0,
    uploadsThisMonth: uploadsMonth?.count ?? 0,
  });
});

router.get("/dashboard/uploads-by-department", requireAuth, async (req, res): Promise<void> => {
  const counts = await db
    .select({
      category: resultsTable.category,
      count: sql<number>`count(*)::int`,
    })
    .from(resultsTable)
    .groupBy(resultsTable.category)
    .orderBy(desc(sql`count(*)`));

  res.json(counts.map((c) => ({ category: c.category, count: c.count })));
});

router.get("/dashboard/recent-activity", requireAuth, async (req, res): Promise<void> => {
  const params = GetRecentActivityQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 10) : 10;

  const logs = await db
    .select()
    .from(auditLogsTable)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit);

  const formatted = logs.map((l) => ({
    id: l.id,
    action: l.action,
    userId: l.userId ?? null,
    userName: l.userName ?? null,
    patientHisId: l.patientHisId ?? null,
    resultId: l.resultId ?? null,
    ipAddress: l.ipAddress,
    details: l.details ?? null,
    createdAt: l.createdAt.toISOString(),
  }));

  res.json(formatted);
});

router.get("/dashboard/daily-uploads", requireAuth, async (req, res): Promise<void> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyCounts = await db
    .select({
      date: sql<string>`date_trunc('day', ${resultsTable.uploadedAt})::date::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(resultsTable)
    .where(gte(resultsTable.uploadedAt, thirtyDaysAgo))
    .groupBy(sql`date_trunc('day', ${resultsTable.uploadedAt})`)
    .orderBy(sql`date_trunc('day', ${resultsTable.uploadedAt})`);

  res.json(dailyCounts);
});

router.get("/dashboard/top-users", requireAuth, async (req, res): Promise<void> => {
  const topUsers = await db
    .select({
      userId: resultsTable.uploadedById,
      uploadCount: sql<number>`count(*)::int`,
    })
    .from(resultsTable)
    .groupBy(resultsTable.uploadedById)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const enriched = await Promise.all(
    topUsers.map(async ({ userId, uploadCount }) => {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      return {
        userId,
        userName: user ? `${user.firstName} ${user.lastName}` : `User #${userId}`,
        role: user?.role ?? "unknown",
        uploadCount,
      };
    })
  );

  res.json(enriched);
});

export default router;
