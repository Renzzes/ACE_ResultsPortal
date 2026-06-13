import { Router } from "express";
import { eq, ilike, or, and, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
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
import { requireAuth, requireRole } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";
import { logAudit } from "../lib/audit";

const router = Router();

const ADMIN_ROLES = ["super_admin"];

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email ?? null,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  };
}

router.get("/users", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = ListUsersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { role, isActive, search, page = 1, limit = 20 } = params.data;

  const conditions = [];
  if (role) conditions.push(eq(usersTable.role, role as typeof usersTable.$inferSelect["role"]));
  if (isActive !== undefined) conditions.push(eq(usersTable.isActive, isActive));
  if (search) {
    conditions.push(
      or(
        ilike(usersTable.username, `%${search}%`),
        ilike(usersTable.firstName, `%${search}%`),
        ilike(usersTable.lastName, `%${search}%`),
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(where);

  const users = await db
    .select()
    .from(usersTable)
    .where(where)
    .limit(limit)
    .offset((page - 1) * limit)
    .orderBy(usersTable.createdAt);

  res.json({
    data: users.map(formatUser),
    total: countResult?.count ?? 0,
    page,
    limit,
  });
});

router.post("/users", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, parsed.data.username));
  if (existing.length > 0) {
    res.status(409).json({ error: "Username already exists" });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const [user] = await db.insert(usersTable).values({
    username: parsed.data.username,
    passwordHash,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email ?? null,
    role: parsed.data.role,
    isActive: true,
  }).returning();

  await logAudit({ action: "upload", req, userId: req.user!.userId, userName: req.user!.username, details: `Created user: ${user.username}` });

  res.status(201).json(formatUser(user));
});

router.get("/users/:id", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
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

  const [user] = await db
    .update(usersTable)
    .set({
      ...(parsed.data.firstName && { firstName: parsed.data.firstName }),
      ...(parsed.data.lastName && { lastName: parsed.data.lastName }),
      ...(parsed.data.email !== undefined && { email: parsed.data.email }),
      ...(parsed.data.role && { role: parsed.data.role }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAudit({ action: "edit", req, userId: req.user!.userId, userName: req.user!.username, details: `Updated user: ${user.username}` });

  res.json(formatUser(user));
});

router.delete("/users/:id", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ isActive: false })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAudit({ action: "delete", req, userId: req.user!.userId, userName: req.user!.username, details: `Deactivated user: ${user.username}` });

  res.json({ message: "User deactivated successfully" });
});

router.post("/users/:id/reset-password", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
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

  const [user] = await db
    .update(usersTable)
    .set({ passwordHash: newHash, failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAudit({ action: "edit", req, userId: req.user!.userId, userName: req.user!.username, details: `Reset password for user: ${user.username}` });

  res.json({ message: "Password reset successfully" });
});

export default router;
