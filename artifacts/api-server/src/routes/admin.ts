import { Router } from "express";
import {
  adminOverviewRepo,
  adminOpsRepo,
  rolePermissionsRepo,
  departmentsRepo,
  patientsRepo,
  resultsRepo,
  listRbacRoles,
  seedPermissionsForDepartment,
  type RolePermissionRow,
  ROLE_PERMISSION_KEYS,
} from "@workspace/db";
import { ListPatientsQueryParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { logAuditBestEffort } from "../lib/audit";
import { formatPatient, physicianName } from "../lib/formatters";

const router = Router();

function formatDepartment(row: Awaited<ReturnType<typeof departmentsRepo.listDepartments>>[number]) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    resultScope: row.resultScope,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Admin Patient Accounts: only hospital patients linked to a real patient-role portal user.
 * Does not replace GET /api/patients (hospital directory for Staff Desk / history / uploads).
 */
router.get("/admin/patient-accounts", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = ListPatientsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { search, page = 1, limit = 20 } = params.data;
  try {
    const result = await patientsRepo.listPortalAccountPatients({ search, page, limit });
    const patientIds = result.data.map((p) => p.id);
    const [counts, physiciansByPatient] = await Promise.all([
      resultsRepo.countResultsByPatientIds(patientIds),
      patientsRepo.listAssignedPhysiciansForPatients(patientIds),
    ]);
    res.json({
      data: result.data.map((p) => {
        const assigned = (physiciansByPatient.get(p.id) ?? []).map((r) => ({
          id: r.id,
          name: physicianName(r.lastName, r.firstName),
        }));
        return {
          ...formatPatient(p, counts[p.id] ?? 0, assigned),
          portalActive: p.portalUserActive,
        };
      }),
      total: result.total,
      page,
      limit,
    });
  } catch {
    res.status(500).json({ error: "Unable to load patient portal accounts." });
  }
});

/** Public: active departments for staff login / create forms. */
router.get("/departments", async (_req, res): Promise<void> => {
  try {
    const rows = await departmentsRepo.listDepartments({ activeOnly: true });
    res.json({ data: rows.map(formatDepartment) });
  } catch {
    res.status(500).json({ error: "Unable to load departments." });
  }
});

router.get("/admin/departments", requireAuth, requireRole("super_admin"), async (_req, res): Promise<void> => {
  try {
    const rows = await departmentsRepo.listDepartments();
    res.json({ data: rows.map(formatDepartment) });
  } catch {
    res.status(500).json({ error: "Unable to load departments." });
  }
});

router.post("/admin/departments", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const name = String(req.body?.name ?? "").trim();
  const codeInput = String(req.body?.code ?? "").trim();
  const resultScope = String(req.body?.resultScope ?? "other");
  if (!name) {
    res.status(400).json({ error: "Department name is required." });
    return;
  }
  if (!["all", "laboratory", "radiology", "other"].includes(resultScope)) {
    res.status(400).json({ error: "Invalid result scope." });
    return;
  }
  if (!(await departmentsRepo.tableExists())) {
    res.status(503).json({
      error: "Departments table missing. Run docs/migration/sql/006_create_departments.sql in SSMS.",
    });
    return;
  }
  try {
    const created = await departmentsRepo.insertDepartment({
      code: codeInput || name,
      name,
      resultScope: resultScope as "all" | "laboratory" | "radiology" | "other",
      sortOrder: Number(req.body?.sortOrder ?? 100),
      isActive: req.body?.isActive !== false,
    });
    await seedPermissionsForDepartment(created.code, {
      audit: created.resultScope === "all",
      archive: created.resultScope === "all",
    });
    await logAuditBestEffort({
      action: "edit",
      req,
      userId: req.user?.userId,
      userName: req.user?.username,
      details: `Created department: ${created.code}`,
    });
    res.status(201).json(formatDepartment(created));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create department.";
    if (message.toLowerCase().includes("unique") || message.includes("UQ_departments_code")) {
      res.status(409).json({ error: "A department with this code already exists." });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.patch("/admin/departments/:id", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid department id." });
    return;
  }
  const patch: {
    name?: string;
    isActive?: boolean;
    sortOrder?: number;
    resultScope?: "all" | "laboratory" | "radiology" | "other";
  } = {};
  if (req.body?.name !== undefined) patch.name = String(req.body.name);
  if (req.body?.isActive !== undefined) patch.isActive = Boolean(req.body.isActive);
  if (req.body?.sortOrder !== undefined) patch.sortOrder = Number(req.body.sortOrder);
  if (req.body?.resultScope !== undefined) {
    const scope = String(req.body.resultScope);
    if (!["all", "laboratory", "radiology", "other"].includes(scope)) {
      res.status(400).json({ error: "Invalid result scope." });
      return;
    }
    patch.resultScope = scope as "all" | "laboratory" | "radiology" | "other";
  }
  try {
    const updated = await departmentsRepo.updateDepartment(id, patch);
    if (!updated) {
      res.status(404).json({ error: "Department not found." });
      return;
    }
    await logAuditBestEffort({
      action: "edit",
      req,
      userId: req.user?.userId,
      userName: req.user?.username,
      details: `Updated department: ${updated.code}`,
    });
    res.json(formatDepartment(updated));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not update department." });
  }
});

router.get("/admin/overview", requireAuth, requireRole("super_admin"), async (_req, res): Promise<void> => {
  try {
    const overview = await adminOverviewRepo.getAdminOverview();
    res.json({
      metrics: overview.metrics,
      activity: overview.activity.map((item) => ({
        id: item.id,
        action: item.action,
        userId: item.userId ?? null,
        userName: item.userName ?? null,
        patientHisId: item.patientHisId ?? null,
        resultId: item.resultId ?? null,
        ipAddress: item.ipAddress,
        details: item.details ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      recentRegistrations: overview.recentRegistrations,
      pendingResults: overview.pendingResults,
      systemOverview: overview.systemOverview,
      systemHealth: overview.systemHealth,
      storage: overview.storage,
      messagingAvailable: overview.messagingAvailable,
    });
  } catch {
    res.status(500).json({ error: "Unable to load dashboard data." });
  }
});

router.get("/admin/monitor", requireAuth, requireRole("super_admin"), async (_req, res): Promise<void> => {
  try {
    const snapshot = await adminOpsRepo.getAdminMonitorSnapshot();
    res.json(snapshot);
  } catch {
    res.status(500).json({ error: "Unable to load monitor data." });
  }
});

router.get("/admin/notifications", requireAuth, requireRole("super_admin"), async (_req, res): Promise<void> => {
  try {
    const items = await adminOpsRepo.getAdminNotifications();
    res.json({ data: items });
  } catch {
    res.status(500).json({ error: "Unable to load notifications." });
  }
});

router.get("/admin/role-permissions", requireAuth, requireRole("super_admin"), async (_req, res): Promise<void> => {
  try {
    const matrix = await rolePermissionsRepo.getRolePermissionsMatrix();
    res.json(matrix);
  } catch {
    res.status(500).json({ error: "Unable to load role permissions." });
  }
});

router.put("/admin/role-permissions", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as RolePermissionRow[]) : null;
  if (!rows || rows.length === 0) {
    res.status(400).json({ error: "rows array is required" });
    return;
  }

  const allowedRoles = new Set(await listRbacRoles());
  for (const row of rows) {
    if (!allowedRoles.has(row.role)) {
      res.status(400).json({ error: `Invalid role: ${String(row.role)}` });
      return;
    }
    for (const key of ROLE_PERMISSION_KEYS) {
      if (typeof row[key] !== "boolean") {
        res.status(400).json({ error: `Invalid permission value for ${row.role}.${key}` });
        return;
      }
    }
  }

  try {
    const matrix = await rolePermissionsRepo.saveRolePermissionsMatrix(rows, req.user?.userId ?? null);
    await logAuditBestEffort({
      action: "edit",
      req,
      userId: req.user?.userId,
      userName: req.user?.username,
      details: "Admin updated role permissions matrix",
    });
    res.json(matrix);
  } catch {
    res.status(500).json({ error: "Unable to save role permissions." });
  }
});

export default router;
