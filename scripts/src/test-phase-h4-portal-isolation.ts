import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { signAccessToken, hashPassword } from "../../artifacts/api-server/src/lib/auth.ts";
import { canListArchive, canViewAuditLogs } from "../../artifacts/api-server/src/lib/rbac.ts";
import { closePool, getPool, initDb, loadRootEnv, sql, usersRepo } from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import { isAccountStatusRole } from "../../artifacts/api-server/src/lib/account-status.ts";
import {
  STAFF_PORTAL_ROLES,
  authoritativeRole,
  decideRoleRoute,
  mayRequestAdminOverview,
  mayRequestAuditOrArchive,
  portalActionForHttpStatus,
  portalHomeForRole,
  shouldApplyAuthBootstrap,
  shouldClearSessionAfterMeFailure,
  userWithAuthoritativeRole,
} from "../../artifacts/ace-results-portal/src/lib/workflow-stability.ts";

loadRootEnv();

/** Ephemeral API for the live HTTP isolation check (does not require PORT=5000). */
let liveServer: Server | undefined;
let liveBase = "";
let liveStaffId = 0;
const liveStamp = Date.now();
const liveStaffUsername = `h4-lab-${liveStamp}`;

function unsignedToken(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ role, type: "access" })).toString("base64url");
  return `${header}.${body}.sig`;
}

const staffAllowed = [...STAFF_PORTAL_ROLES, "super_admin"] as const;

test("a stored super_admin profile cannot override a staff access token", () => {
  const token = unsignedToken("laboratory");
  assert.equal(authoritativeRole("super_admin", token), "laboratory");
  assert.equal(userWithAuthoritativeRole({ id: 9, role: "super_admin" }, token)?.role, "laboratory");
  assert.equal(mayRequestAdminOverview("laboratory"), false);
  assert.equal(mayRequestAuditOrArchive("laboratory"), false);
  assert.equal(mayRequestAuditOrArchive("radiology"), false);
  assert.equal(mayRequestAuditOrArchive("endoscopy"), false);
  assert.equal(mayRequestAdminOverview("super_admin"), true);
  assert.equal(mayRequestAuditOrArchive("medical_records"), true);
});

test("staff receiving 403 stays in the staff portal", () => {
  const role = authoritativeRole("super_admin", unsignedToken("laboratory"));
  assert.equal(portalActionForHttpStatus(403), "stay");
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role,
      allowedRoles: staffAllowed,
      loginTo: "/login",
    }),
    { kind: "render" },
  );
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role,
      allowedRoles: ["super_admin"],
      loginTo: "/login",
    }),
    { kind: "redirect", to: "/dashboard" },
  );
  assert.notEqual(portalHomeForRole(role), "/admin");
});

test("physician, patient, and super_admin refresh to their own portals", () => {
  assert.equal(portalHomeForRole(authoritativeRole("laboratory", unsignedToken("physician"))), "/physician/overview");
  assert.equal(portalHomeForRole(authoritativeRole("super_admin", unsignedToken("patient"))), "/portal/dashboard");
  assert.equal(portalHomeForRole(authoritativeRole(undefined, unsignedToken("super_admin"))), "/admin");
  for (const role of ["laboratory", "radiology", "endoscopy", "medical_records"] as const) {
    assert.equal(portalHomeForRole(authoritativeRole("super_admin", unsignedToken(role))), "/dashboard");
    assert.deepEqual(
      decideRoleRoute({
        sessionReady: true,
        hasUser: true,
        role,
        allowedRoles: staffAllowed,
        loginTo: "/login",
      }),
      { kind: "render" },
    );
  }
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role: "physician",
      allowedRoles: ["physician"],
      loginTo: "/login?as=doctor",
    }),
    { kind: "render" },
  );
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role: "patient",
      allowedRoles: staffAllowed,
      loginTo: "/login",
    }),
    { kind: "redirect", to: "/portal/dashboard" },
  );
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role: "super_admin",
      allowedRoles: ["super_admin"],
      loginTo: "/login",
    }),
    { kind: "render" },
  );
});

test("an unresolved role stays loading and never defaults to admin", () => {
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: false,
      hasUser: true,
      role: undefined,
      allowedRoles: ["super_admin"],
      loginTo: "/login",
    }),
    { kind: "loading" },
  );
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role: "",
      allowedRoles: ["super_admin"],
      loginTo: "/login",
    }),
    { kind: "login", to: "/login" },
  );
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role: "not-a-role",
      allowedRoles: staffAllowed,
      loginTo: "/login",
    }),
    { kind: "login", to: "/login" },
  );
  assert.equal(portalHomeForRole("not-a-role"), null);
  assert.equal(portalHomeForRole(undefined), null);
});

test("401 recovers the session and 403 does not log a staff role out", () => {
  assert.equal(portalActionForHttpStatus(401), "recover-session");
  assert.equal(portalActionForHttpStatus(403), "stay");
  assert.equal(portalActionForHttpStatus(500), "stay");
  assert.equal(
    shouldClearSessionAfterMeFailure({
      status: 403,
      accessTokenStillPresent: true,
      refreshOutcome: "none",
      tokenRole: "radiology",
    }),
    false,
  );
  assert.equal(
    shouldClearSessionAfterMeFailure({
      status: 403,
      accessTokenStillPresent: true,
      refreshOutcome: "none",
      tokenRole: "patient",
    }),
    true,
  );
  assert.equal(
    shouldClearSessionAfterMeFailure({
      status: 401,
      accessTokenStillPresent: false,
      refreshOutcome: "rejected",
      tokenRole: "laboratory",
    }),
    true,
  );
});

test("a newer login discards an in-flight auth bootstrap", () => {
  assert.equal(
    shouldApplyAuthBootstrap({
      cancelled: false,
      epochAtStart: 1,
      epochNow: 2,
      tokenAtStart: "admin-token",
      tokenNow: "staff-token",
    }),
    false,
  );
  assert.equal(
    shouldApplyAuthBootstrap({
      cancelled: false,
      epochAtStart: 1,
      epochNow: 1,
      tokenAtStart: "staff-token",
      tokenNow: "staff-token",
    }),
    true,
  );
});

test("restricted staff roles are still forbidden from admin, audit, and archive APIs", () => {
  for (const role of ["laboratory", "radiology", "endoscopy"] as const) {
    assert.equal(canViewAuditLogs(role), false);
    assert.equal(canListArchive(role), false);
  }
  const admin = readFileSync(new URL("../../artifacts/api-server/src/routes/admin.ts", import.meta.url), "utf8");
  const overview = admin.slice(admin.indexOf('"/admin/overview"'));
  assert.match(overview.slice(0, 180), /requireRole\("super_admin"\)/);
  const fetchWrapper = readFileSync(
    new URL("../../lib/api-client-react/src/custom-fetch.ts", import.meta.url),
    "utf8",
  );
  assert.match(fetchWrapper, /response\.status === 401/);
  assert.equal(fetchWrapper.includes("status === 403"), false);
  const app = readFileSync(new URL("../../artifacts/ace-results-portal/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /useAuthoritativeRole\(\)/);
  assert.equal(app.includes("status === 403"), false);
});

test("LIVE restricted staff token receives 403 and is not routed to admin", async () => {
  await initDb();
  liveServer = app.listen(0);
  const address = liveServer.address() as AddressInfo;
  liveBase = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${liveBase}/api/healthz`);
  assert.equal(health.status, 200);

  // Own fixture: do not depend on removed bootstrap staff or production accounts.
  const passwordHash = await hashPassword(`H4Live${liveStamp}!`);
  const staff = await usersRepo.insertUser({
    username: liveStaffUsername,
    passwordHash,
    firstName: "H4",
    lastName: "Lab",
    email: null,
    role: "laboratory",
  });
  liveStaffId = staff.id;
  assert.equal(isAccountStatusRole(staff.role), true);

  const token = signAccessToken({ userId: staff.id, username: staff.username, role: staff.role });
  const role = authoritativeRole("super_admin", token);
  assert.equal(role, staff.role);
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role,
      allowedRoles: staffAllowed,
      loginTo: "/login",
    }),
    { kind: "render" },
  );
  assert.equal(portalActionForHttpStatus(403), "stay");

  const checks = [
    { path: "/api/admin/overview", allowed: false },
    { path: "/api/audit-logs?page=1&limit=50", allowed: canViewAuditLogs(staff.role) },
    { path: "/api/archive?page=1&limit=20", allowed: canListArchive(staff.role) },
  ] as const;
  const denied = checks.filter((check) => !check.allowed);
  assert.ok(denied.length > 0);
  for (const check of denied) {
    const response = await fetch(`${liveBase}${check.path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 403, check.path);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Forbidden");
  }
});

after(async () => {
  if (liveStaffId > 0) {
    const pool = await getPool();
    await pool.request().input("id", sql.Int, liveStaffId).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
    await pool.request().input("id", sql.Int, liveStaffId).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
  }
  await new Promise<void>((resolve) => {
    if (!liveServer) {
      resolve();
      return;
    }
    liveServer.close(() => resolve());
  });
  await closePool().catch(() => undefined);
});
