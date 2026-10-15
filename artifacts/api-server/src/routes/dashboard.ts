import { Router } from "express";
import {
  auditLogsRepo,
  patientsRepo,
  resultReviewsRepo,
  resultsRepo,
  usersRepo,
  type ResultCategory,
} from "@workspace/db";
import { GetRecentActivityQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { denyAccess } from "../lib/audit";
import {
  canViewAuditLogs,
  canViewDashboardDetails,
  resolveResultCategoryScope,
  scopeFailure,
  type CategoryAuthorization,
} from "../lib/rbac";
import { formatResult } from "../lib/formatters";
import { staffDirectoryConstraint } from "../lib/patient-department-access";

const router = Router();

function scopeCategories(allowed: ResultCategory[] | "all" | "none"): ResultCategory[] | undefined {
  if (allowed === "all") return undefined;
  if (allowed === "none") return [];
  return allowed;
}

function categoriesFromScope(scope: CategoryAuthorization): ResultCategory[] | "all" | "none" {
  if (scope.status === "ok") return scope.categories;
  return "none";
}

async function membershipPatientIds(role: string): Promise<
  | { ok: true; patientIds?: number[] }
  | { ok: false; status: 403 | 500 | 503; error: string }
> {
  const constraint = await staffDirectoryConstraint(role);
  if (constraint.kind === "error") {
    return { ok: false, status: constraint.status, error: constraint.error };
  }
  if (constraint.kind === "ids") return { ok: true, patientIds: constraint.ids };
  return { ok: true };
}

function sendScopeError(
  req: Parameters<typeof denyAccess>[0],
  res: Parameters<typeof denyAccess>[1],
  status: 403 | 500 | 503,
  error: string,
  details: string,
): Promise<void> {
  if (status === 403) {
    return denyAccess(req, res, { error, details });
  }
  res.status(status).json({ error });
  return Promise.resolve();
}

function pendingLabel(allowed: ResultCategory[] | "all" | "none"): string {
  if (allowed === "all" || allowed === "none") return "Pending Results";
  if (allowed.length === 1 && allowed[0] === "laboratory") return "Pending Lab Results";
  if (allowed.includes("laboratory") && allowed.length === 1) return "Pending Lab Results";
  const imagingOnly = allowed.every((c) =>
    ["radiology", "ultrasound", "ct_scan", "mri", "ecg", "echo_2d", "rehabilitation", "other"].includes(c),
  );
  if (imagingOnly && allowed.some((c) => c !== "other")) return "Pending Imaging Results";
  return "Pending Results";
}

router.get("/dashboard/stats", requireAuth, async (req, res): Promise<void> => {
  const scope = await resolveResultCategoryScope(req.user!.role);
  const failure = scopeFailure(scope);
  if (failure) {
    if (failure.status === 403) {
      await denyAccess(req, res, {
        error: failure.error,
        details: "Unauthorized attempt to view dashboard statistics outside department scope",
      });
      return;
    }
    res.status(failure.status).json({ error: failure.error });
    return;
  }
  const allowed = categoriesFromScope(scope);
  const categories = scopeCategories(allowed);
  const emptyCategories = Array.isArray(categories) && categories.length === 0;
  const membership = await membershipPatientIds(req.user!.role);
  if (!membership.ok) {
    await sendScopeError(
      req,
      res,
      membership.status,
      membership.error,
      "Unauthorized attempt to view dashboard statistics outside department membership",
    );
    return;
  }
  const patientIds = membership.patientIds;

  const [patientCount, resultStats, userStats, downloadCount] = await Promise.all([
    patientIds ? Promise.resolve(patientIds.length) : patientsRepo.countPatients(),
    emptyCategories
      ? Promise.resolve({
          total: 0,
          released: 0,
          pending: 0,
          archived: 0,
          uploadsToday: 0,
          uploadsThisMonth: 0,
        })
      : resultsRepo.getResultStats(categories, patientIds),
    usersRepo.countUsersByRole(),
    auditLogsRepo.countDownloads(),
  ]);

  res.json({
    totalPatients: patientCount,
    totalResults: resultStats.total,
    totalReleased: resultStats.released,
    totalPending: resultStats.pending,
    totalArchived: resultStats.archived,
    totalDownloads: downloadCount,
    totalStaffUsers: userStats.totalStaff,
    totalPhysicians: userStats.totalPhysicians,
    uploadsToday: resultStats.uploadsToday,
    uploadsThisMonth: resultStats.uploadsThisMonth,
    pendingLabel: pendingLabel(allowed),
  });
});

/**
 * Staff Desk aggregate — department-scoped charts and panels.
 * Uses existing tables only (patients, results, audit_logs, users).
 */
router.get("/dashboard/staff-desk", requireAuth, async (req, res): Promise<void> => {
  try {
    const role = req.user!.role;
    if (role === "physician" || role === "patient") {
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to access staff desk dashboard",
      });
      return;
    }

    const scope = await resolveResultCategoryScope(role);
    const failure = scopeFailure(scope);
    if (failure) {
      if (failure.status === 403) {
        await denyAccess(req, res, {
          error: failure.error,
          details: "Unauthorized attempt to view staff desk outside department scope",
        });
        return;
      }
      res.status(failure.status).json({ error: failure.error });
      return;
    }
    const allowed = categoriesFromScope(scope);
    const categories = scopeCategories(allowed);
    const emptyCategories = Array.isArray(categories) && categories.length === 0;
    const canAudit = canViewAuditLogs(role);
    const membership = await membershipPatientIds(role);
    if (!membership.ok) {
      await sendScopeError(
        req,
        res,
        membership.status,
        membership.error,
        "Unauthorized attempt to view staff desk outside department membership",
      );
      return;
    }
    const memberPatientIds = membership.patientIds;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const [
      patientCount,
      resultStats,
      userStats,
      dailyRaw,
      categoryRaw,
      recentPatients,
      recentResultsPage,
      pendingResultsPage,
      recentActivity,
      reviewedToday,
      recentReviews,
    ] = await Promise.all([
      memberPatientIds ? Promise.resolve(memberPatientIds.length) : patientsRepo.countPatients(),
      emptyCategories
        ? Promise.resolve({
            total: 0,
            released: 0,
            pending: 0,
            archived: 0,
            uploadsToday: 0,
            uploadsThisMonth: 0,
          })
        : resultsRepo.getResultStats(categories, memberPatientIds),
      usersRepo.countUsersByRole(),
      emptyCategories ? Promise.resolve([]) : resultsRepo.getDailyUploads(sevenDaysAgo, categories, memberPatientIds),
      emptyCategories ? Promise.resolve([]) : resultsRepo.getUploadsByDepartment(categories, memberPatientIds),
      patientsRepo.listPatients({ ids: memberPatientIds, page: 1, limit: 8 }),
      emptyCategories
        ? Promise.resolve({ data: [], total: 0 })
        : resultsRepo.listResults({
            categories,
            patientIds: memberPatientIds,
            page: 1,
            limit: 8,
          }),
      emptyCategories
        ? Promise.resolve({ data: [], total: 0 })
        : resultsRepo.listResults({
            categories,
            patientIds: memberPatientIds,
            status: "pending",
            page: 1,
            limit: 6,
          }),
      canAudit ? auditLogsRepo.listRecentActivity(8) : Promise.resolve([]),
      emptyCategories
        ? Promise.resolve(0)
        : resultReviewsRepo.countReviewedToday(categories, memberPatientIds),
      emptyCategories
        ? Promise.resolve([])
        : resultReviewsRepo.listRecentReviewsForDesk(12, categories, memberPatientIds),
    ]);

    const dayMap = new Map(dailyRaw.map((row) => [row.date, row.count]));
    const activity7d: Array<{ date: string; label: string; count: number }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(sevenDaysAgo.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      activity7d.push({
        date: key,
        label: d.toLocaleDateString("en-US", { weekday: "short" }),
        count: dayMap.get(key) ?? 0,
      });
    }

    const patientIds = [
      ...new Set([
        ...recentResultsPage.data.map((r) => r.patientId),
        ...pendingResultsPage.data.map((r) => r.patientId),
      ]),
    ];
    const patientsById = new Map(
      (
        await Promise.all(patientIds.map(async (id) => [id, await patientsRepo.findPatientById(id)] as const))
      ).filter((entry) => entry[1]),
    );

    const enrich = (rows: typeof recentResultsPage.data) =>
      rows.map((r) => {
        const patient = patientsById.get(r.patientId);
        return {
          ...formatResult(r),
          patientHisId: patient?.patientHisId ?? "",
          patientName: patient ? `${patient.lastName}, ${patient.firstName}` : `Patient #${r.patientId}`,
        };
      });

    const resultCounts = await resultsRepo.countResultsByPatientIds(recentPatients.data.map((p) => p.id));

    res.json({
      pendingLabel: pendingLabel(allowed),
      stats: {
        totalPatients: patientCount,
        totalPhysicians: userStats.totalPhysicians,
        totalPending: resultStats.pending,
        totalReleased: resultStats.released,
        totalArchived: resultStats.archived,
        uploadsToday: resultStats.uploadsToday,
        reviewedToday,
        totalResults: resultStats.total,
      },
      activity7d,
      statusBreakdown: [
        { status: "pending", count: resultStats.pending },
        { status: "released", count: resultStats.released },
        { status: "archived", count: resultStats.archived },
      ],
      categoryBreakdown: categoryRaw.map((row) => ({
        category: row.category,
        count: row.count,
      })),
      recentPatients: recentPatients.data.map((p) => ({
        id: p.id,
        patientHisId: p.patientHisId,
        firstName: p.firstName,
        middleName: p.middleName,
        lastName: p.lastName,
        dateOfBirth: String(p.dateOfBirth).slice(0, 10),
        createdAt: p.createdAt.toISOString(),
        resultCount: resultCounts[p.id] ?? 0,
      })),
      recentResults: enrich(recentResultsPage.data),
      pendingResults: enrich(pendingResultsPage.data),
      recentReviews: recentReviews.map((row) => ({
        id: row.id,
        resultId: row.resultId,
        physicianId: row.physicianId,
        physicianName: row.physicianName,
        comment: row.comment,
        reviewedAt: row.reviewedAt.toISOString(),
        patientId: row.patientId,
        patientHisId: row.patientHisId,
        patientName: row.patientName,
        category: row.category,
        originalFileName: row.originalFileName,
      })),
      canViewAudit: canAudit,
      recentActivity: recentActivity.map((l) => ({
        id: l.id,
        action: l.action,
        userId: l.userId ?? null,
        userName: l.userName ?? null,
        patientHisId: l.patientHisId ?? null,
        resultId: l.resultId ?? null,
        details: l.details ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch {
    res.status(500).json({ error: "Unable to load dashboard data." });
  }
});

router.get("/dashboard/uploads-by-department", requireAuth, async (req, res): Promise<void> => {
  if (!canViewDashboardDetails(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to view dashboard department uploads",
    });
    return;
  }
  const scope = await resolveResultCategoryScope(req.user!.role);
  const failure = scopeFailure(scope);
  if (failure) {
    if (failure.status === 403) {
      await denyAccess(req, res, {
        error: failure.error,
        details: "Unauthorized attempt to view dashboard department uploads",
      });
      return;
    }
    res.status(failure.status).json({ error: failure.error });
    return;
  }
  const categories = scopeCategories(categoriesFromScope(scope));
  if (Array.isArray(categories) && categories.length === 0) {
    res.json([]);
    return;
  }
  const counts = await resultsRepo.getUploadsByDepartment(categories);
  res.json(counts);
});

router.get("/dashboard/recent-activity", requireAuth, async (req, res): Promise<void> => {
  if (!canViewAuditLogs(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to view recent audit activity",
    });
    return;
  }
  const params = GetRecentActivityQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 10) : 10;
  const logs = await auditLogsRepo.listRecentActivity(limit);
  res.json(
    logs.map((l) => ({
      id: l.id,
      action: l.action,
      userId: l.userId ?? null,
      userName: l.userName ?? null,
      patientHisId: l.patientHisId ?? null,
      resultId: l.resultId ?? null,
      ipAddress: l.ipAddress,
      details: l.details ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
  );
});

router.get("/dashboard/daily-uploads", requireAuth, async (req, res): Promise<void> => {
  if (!canViewDashboardDetails(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to view dashboard daily uploads",
    });
    return;
  }
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const scope = await resolveResultCategoryScope(req.user!.role);
  const failure = scopeFailure(scope);
  if (failure) {
    if (failure.status === 403) {
      await denyAccess(req, res, {
        error: failure.error,
        details: "Unauthorized attempt to view dashboard daily uploads",
      });
      return;
    }
    res.status(failure.status).json({ error: failure.error });
    return;
  }
  const categories = scopeCategories(categoriesFromScope(scope));
  if (Array.isArray(categories) && categories.length === 0) {
    res.json([]);
    return;
  }
  const dailyCounts = await resultsRepo.getDailyUploads(thirtyDaysAgo, categories);
  res.json(dailyCounts);
});

router.get("/dashboard/top-users", requireAuth, async (req, res): Promise<void> => {
  if (!canViewDashboardDetails(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to view dashboard top users",
    });
    return;
  }
  const topUsers = await resultsRepo.getTopUploaders(10);
  const enriched = await Promise.all(
    topUsers.map(async ({ userId, uploadCount }) => {
      const user = await usersRepo.findUserById(userId);
      return {
        userId,
        userName: user ? `${user.firstName} ${user.lastName}` : `User #${userId}`,
        role: user?.role ?? "unknown",
        uploadCount,
      };
    }),
  );
  res.json(enriched);
});

export default router;
