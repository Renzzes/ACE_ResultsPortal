import { Router } from "express";
import { authSessionsRepo, usersRepo, departmentsRepo } from "@workspace/db";
import {
  ListUsersQueryParams,
  GetUserParams,
  UpdateUserParams,
  DeleteUserParams,
  ResetUserPasswordParams,
  CreateUserBody,
  UpdateUserBody,
  ResetUserPasswordBody,
} from "@workspace/api-zod";
import { PORTAL_USER_ROLE } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";
import { isAccountStatusRole } from "../lib/account-status";
import { logAudit } from "../lib/audit";
import { formatUser } from "../lib/formatters";
import { physicianName } from "../lib/formatters";
import type { UserRole } from "@workspace/db";

const router = Router();

async function assertAssignableRole(role: string): Promise<string | null> {
  if (role === "super_admin" || role === "physician") return null;
  if (role === "patient") return "Cannot create patient accounts from staff user admin.";
  const department = await departmentsRepo.findDepartmentByCode(role);
  if (!department) {
    return "Unknown department. Add it under Admin → Departments first.";
  }
  if (!department.isActive) {
    return "That department is inactive.";
  }
  return null;
}

function statusAuditDetails(input: {
  targetUserId: number;
  targetUsername: string;
  previousActive: boolean;
  nextActive: boolean;
}): string {
  return JSON.stringify({
    operation: "account_status",
    targetUserId: input.targetUserId,
    targetUsername: input.targetUsername,
    previousStatus: input.previousActive ? "active" : "inactive",
    newStatus: input.nextActive ? "active" : "inactive",
  });
}

router.get("/users", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = ListUsersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { role, isActive, search, page = 1, limit = 20 } = params.data;
  // Patient Portal identities are not employee accounts. Staff/Doctor admin must not list them.
  if (role === PORTAL_USER_ROLE) {
    res.json({ data: [], total: 0, page, limit });
    return;
  }
  const result = await usersRepo.listUsers({
    role,
    isActive,
    search,
    page,
    limit,
    excludeRoles: role ? undefined : [PORTAL_USER_ROLE],
  });
  res.json({
    data: result.data.map(formatUser),
    total: result.total,
    page,
    limit,
  });
});

router.post("/users", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path?.join(".") || "input";
    const hint =
      field === "password"
        ? "Password must be at least 8 characters"
        : field === "username"
          ? "Username must be at least 3 characters"
          : first?.message || "Invalid account details";
    res.status(400).json({ error: hint });
    return;
  }

  const roleError = await assertAssignableRole(parsed.data.role);
  if (roleError) {
    res.status(400).json({ error: roleError });
    return;
  }

  const existing = await usersRepo.findUserByUsername(parsed.data.username);
  if (existing) {
    res.status(409).json({ error: "Username already exists" });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  let user;
  try {
    user = await usersRepo.insertUser({
      username: parsed.data.username,
      passwordHash,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email ?? null,
      role: parsed.data.role as UserRole,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("CK_users_role")) {
      res.status(400).json({
        error:
          "Database role constraint rejects this role. Run docs/migration/sql/006_create_departments.sql in SSMS, then retry.",
      });
      return;
    }
    throw err;
  }

  await logAudit({
    action: "upload",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    details: `Created user: ${user.username}`,
  });

  res.status(201).json(formatUser(user));
});

router.get("/users/:id", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = await usersRepo.findUserById(params.data.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

router.patch("/users/:id", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.role) {
    const roleError = await assertAssignableRole(parsed.data.role);
    if (roleError) {
      res.status(400).json({ error: roleError });
      return;
    }
  }

  const existing = await usersRepo.findUserById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (parsed.data.isActive !== undefined && !isAccountStatusRole(existing.role)) {
    res.status(403).json({ error: "Account status can only be changed for staff and doctor accounts." });
    return;
  }

  if (parsed.data.isActive === false && existing.id === req.user!.userId) {
    res.status(400).json({ error: "You cannot deactivate your own account" });
    return;
  }

  const user = await usersRepo.updateUser(params.data.id, {
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email,
    role: parsed.data.role as UserRole | undefined,
    isActive: parsed.data.isActive,
  });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (parsed.data.isActive === false && isAccountStatusRole(existing.role)) {
    await authSessionsRepo.revokeAllForUser(existing.id);
  }

  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    details:
      parsed.data.isActive === undefined
        ? `Updated user: ${user.username}`
        : statusAuditDetails({
            targetUserId: user.id,
            targetUsername: user.username,
            previousActive: existing.isActive,
            nextActive: user.isActive,
          }),
  });
  res.json(formatUser(user));
});

router.delete("/users/:id", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const existing = await usersRepo.findUserById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!isAccountStatusRole(existing.role)) {
    res.status(403).json({ error: "Account status can only be changed for staff and doctor accounts." });
    return;
  }
  if (existing.id === req.user!.userId) {
    res.status(400).json({ error: "You cannot deactivate your own account" });
    return;
  }
  const user = await usersRepo.updateUser(params.data.id, { isActive: false });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await authSessionsRepo.revokeAllForUser(user.id);
  await logAudit({
    action: "delete",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    details: statusAuditDetails({
      targetUserId: user.id,
      targetUsername: user.username,
      previousActive: existing.isActive,
      nextActive: false,
    }),
  });
  res.json({ message: "User deactivated successfully", ...formatUser(user) });
});

router.post(
  "/users/:id/reset-password",
  requireAuth,
  requireRole("super_admin"),
  async (req, res): Promise<void> => {
    const params = ResetUserPasswordParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = ResetUserPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const newHash = await hashPassword(parsed.data.newPassword);
    const user = await usersRepo.setUserPassword(params.data.id, newHash, true);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await logAudit({
      action: "edit",
      req,
      userId: req.user!.userId,
      userName: req.user!.username,
      details: `Reset password for user: ${user.username}`,
    });
    res.json({ message: "Password reset successfully" });
  },
);

router.get("/physicians", requireAuth, async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const physicians = await usersRepo.listActivePhysicians(search);
  res.json(
    physicians.map((p) => ({
      id: p.id,
      name: physicianName(p.lastName, p.firstName),
      username: p.username,
    })),
  );
});

export default router;
