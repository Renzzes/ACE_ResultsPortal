import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  LoginBody,
  RefreshTokenBody,
  ChangePasswordBody,
} from "@workspace/api-zod";
import {
  signAccessToken,
  signRefreshToken,
  comparePassword,
  hashPassword,
  verifyToken,
} from "../lib/auth";
import { requireAuth } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

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

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (!user || !user.isActive) {
    await logAudit({ action: "access_denied", req, details: `Failed login: ${username}` });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Check lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    res.status(403).json({ error: `Account locked until ${user.lockedUntil.toISOString()}. Try again later.` });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);

  if (!valid) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
      : null;

    await db.update(usersTable).set({
      failedLoginAttempts: attempts,
      lockedUntil: lockedUntil ?? undefined,
    }).where(eq(usersTable.id, user.id));

    await logAudit({ action: "access_denied", req, userId: user.id, userName: user.username, details: `Failed login attempt ${attempts}` });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Reset failed attempts on success
  await db.update(usersTable).set({
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  const tokenPayload = { userId: user.id, username: user.username, role: user.role };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  await logAudit({ action: "login", req, userId: user.id, userName: user.username });

  res.json({ accessToken, refreshToken, user: formatUser(user) });
});

router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  await logAudit({ action: "logout", req, userId: req.user!.userId, userName: req.user!.username });
  res.json({ message: "Logged out successfully" });
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const parsed = RefreshTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const payload = verifyToken(parsed.data.refreshToken);
  if (!payload || payload["type"] !== "refresh") {
    res.status(401).json({ error: "Invalid refresh token" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload["userId"] as number));

  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  const tokenPayload = { userId: user.id, username: user.username, role: user.role };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  res.json({ accessToken, refreshToken, user: formatUser(user) });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(formatUser(user));
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));

  await logAudit({ action: "edit", req, userId: user.id, userName: user.username, details: "Changed password" });

  res.json({ message: "Password changed successfully" });
});

export default router;
