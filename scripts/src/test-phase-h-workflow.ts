import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { hashPassword } from "../../artifacts/api-server/src/lib/auth.ts";
import { LOG_REDACT_PATHS } from "../../artifacts/api-server/src/lib/logger.ts";
import { loggedRequestBodyFailure } from "../../artifacts/api-server/src/lib/request-body-error.ts";
import { canAssignPhysicians } from "../../artifacts/api-server/src/lib/rbac.ts";
import {
  closePool,
  getPool,
  initDb,
  loadDbConfig,
  loadRootEnv,
  patientsRepo,
  sql,
  usersRepo,
} from "@workspace/db";
import app from "../../artifacts/api-server/src/app.ts";
import bcrypt from "bcryptjs";
import {
  PORTAL_SESSION_KEYS,
  STAFF_PORTAL_ROLES,
  STAFF_SESSION_KEYS,
  decideRoleRoute,
  nextAttendingAssignments,
  passwordResetErrorMessage,
  patientPrefillId,
  portalHomeForRole,
  registrationUploadPath,
  roleFromAccessTokenPayload,
  shouldClearSessionAfterMeFailure,
  uploadSelectionFromPatient,
} from "../../artifacts/ace-results-portal/src/lib/workflow-stability.ts";

loadRootEnv();

/** Ephemeral in-process API — do not require a separately started PORT=5000 server. */
let liveServer: Server | undefined;
let api = "";
const stamp = Date.now();
const physicianUsername = `h-wf-md-${stamp}`;
const labUsername = `h-wf-lab-${stamp}`;
const patientHisId = `HWF-${stamp}`;
let physicianId = 0;
let labStaffId = 0;
let patientId = 0;

const usersRoute = readFileSync(
  new URL("../../artifacts/api-server/src/routes/users.ts", import.meta.url),
  "utf8",
);
const usersRepoSource = readFileSync(
  new URL("../../lib/db/src/repos/users.ts", import.meta.url),
  "utf8",
);

test("super_admin is the only role allowed to reset a password", () => {
  const handler = usersRoute.slice(usersRoute.indexOf('"/users/:id/reset-password"'));
  assert.match(handler, /requireRole\("super_admin"\)/);
  assert.doesNotMatch(handler.slice(0, 400), /requireRole\([^)]*physician/);
});

test("physician cannot reset another user's password", () => {
  assert.equal(canAssignPhysicians("physician"), false);
  const handler = usersRoute.slice(usersRoute.indexOf('"/users/:id/reset-password"'));
  assert.match(handler, /requireRole\("super_admin"\)/);
  assert.equal(handler.includes('requireRole("physician")'), false);
});

test("password reset stores a hash and the UI hides sensitive failures", async () => {
  const hash = await hashPassword("Example-Pass-1");
  assert.notEqual(hash, "Example-Pass-1");
  assert.match(hash, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare("Example-Pass-1", hash), true);
  assert.equal(
    passwordResetErrorMessage({
      status: 500,
      serverMessage: "password_hash $2b$10$abcdefghijklmnopqrstuv",
      submittedPassword: "Example-Pass-1",
    }),
    "Could not reset password",
  );
  assert.equal(
    passwordResetErrorMessage({ status: 403, serverMessage: "Forbidden" }),
    "You are not allowed to reset this password.",
  );
  assert.equal(
    passwordResetErrorMessage({
      status: 400,
      serverMessage: "Password must be at least 8 characters",
    }),
    "Password must be at least 8 characters",
  );
});

test("malformed JSON is rejected without logging the raw password", () => {
  const secret = "SuperSecret99";
  const err = Object.assign(new SyntaxError(`Unexpected token 'S', "${secret}" is not valid JSON`), {
    type: "entity.parse.failed",
    status: 400,
    body: `{"newPassword":"${secret}"}`,
  });
  const failure = loggedRequestBodyFailure(err);
  assert.ok(failure);
  assert.equal(failure.status, 400);
  assert.equal(failure.clientError, "Invalid request body");
  const logged = JSON.stringify(failure.log);
  assert.equal(logged.includes(secret), false);
  assert.equal(logged.includes("newPassword"), false);
  assert.equal(loggedRequestBodyFailure(new Error("database offline")), null);
  for (const path of ["newPassword", "*.newPassword", "err.body", "err.raw.body"]) {
    assert.equal(LOG_REDACT_PATHS.includes(path), true);
  }
});

test("password update does not change role or is_active", () => {
  const sets = usersRepoSource.match(/SET password_hash = @passwordHash[\s\S]*?OUTPUT/g) ?? [];
  assert.equal(sets.length, 2);
  for (const clause of sets) {
    assert.doesNotMatch(clause, /\brole\b/);
    assert.doesNotMatch(clause, /is_active/);
  }
});

test("registration handoff keeps the server patient id and omits the access code", () => {
  const path = registrationUploadPath(42);
  assert.equal(path, "/results/upload?patientId=42");
  assert.equal(path.includes("access"), false);
  assert.equal(patientPrefillId("42"), 42);
  assert.equal(patientPrefillId("SMITH"), null);
  assert.throws(() => registrationUploadPath(0));
});

test("upload page selects the patient loaded by id", () => {
  const selected = uploadSelectionFromPatient({
    id: 42,
    patientHisId: "HIS-9",
    lastName: "Santos",
    firstName: "Ana",
  });
  assert.deepEqual(selected, { id: 42, patientHisId: "HIS-9", name: "Santos, Ana" });
  assert.notEqual(String(selected.id), selected.patientHisId);
});

test("adding a physician preserves the current assignment and rejects a duplicate", () => {
  const first = nextAttendingAssignments([], 10);
  const second = nextAttendingAssignments(first.ids, 11);
  const duplicate = nextAttendingAssignments(second.ids, 10);
  assert.deepEqual(second.ids, [10, 11]);
  assert.equal(second.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.ids, [10, 11]);
});

test("laboratory and radiology staff cannot assign attending physicians", () => {
  assert.equal(canAssignPhysicians("super_admin"), true);
  assert.equal(canAssignPhysicians("medical_records"), true);
  assert.equal(canAssignPhysicians("laboratory"), false);
  assert.equal(canAssignPhysicians("radiology"), false);
  assert.equal(canAssignPhysicians("endoscopy"), false);
  assert.equal(canAssignPhysicians("physician"), false);
});

test("each restored role has its own portal and dashboard is only the staff home", () => {
  assert.equal(portalHomeForRole("super_admin"), "/admin");
  assert.equal(portalHomeForRole("medical_records"), "/dashboard");
  assert.equal(portalHomeForRole("laboratory"), "/dashboard");
  assert.equal(portalHomeForRole("radiology"), "/dashboard");
  assert.equal(portalHomeForRole("endoscopy"), "/dashboard");
  assert.equal(portalHomeForRole("physician"), "/physician/overview");
  assert.equal(portalHomeForRole("patient"), "/portal/dashboard");
  assert.equal(portalHomeForRole(""), null);
  assert.equal(portalHomeForRole("unknown"), null);
});

test("auth loading does not redirect, and a missing role does not open the staff portal", () => {
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
      allowedRoles: STAFF_PORTAL_ROLES,
      loginTo: "/login",
    }),
    { kind: "login", to: "/login" },
  );
});

test("restored admin and physician stay out of the staff portal when the URL is not theirs", () => {
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
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role: "super_admin",
      allowedRoles: ["physician"],
      loginTo: "/login?as=doctor",
    }),
    { kind: "redirect", to: "/admin" },
  );
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
      role: "physician",
      allowedRoles: [...STAFF_PORTAL_ROLES, "super_admin"],
      loginTo: "/login",
    }),
    { kind: "redirect", to: "/physician/overview" },
  );
  for (const role of STAFF_PORTAL_ROLES) {
    assert.deepEqual(
      decideRoleRoute({
        sessionReady: true,
        hasUser: true,
        role,
        allowedRoles: [...STAFF_PORTAL_ROLES, "super_admin"],
        loginTo: "/login",
      }),
      { kind: "render" },
    );
  }
  assert.deepEqual(
    decideRoleRoute({
      sessionReady: true,
      hasUser: true,
      role: "patient",
      allowedRoles: [...STAFF_PORTAL_ROLES, "super_admin"],
      loginTo: "/login",
    }),
    { kind: "redirect", to: "/portal/dashboard" },
  );
});

test("only a confirmed invalid session is cleared", () => {
  assert.equal(
    shouldClearSessionAfterMeFailure({ status: 401, accessTokenStillPresent: false, refreshOutcome: "rejected" }),
    true,
  );
  assert.equal(
    shouldClearSessionAfterMeFailure({ status: 401, accessTokenStillPresent: true, refreshOutcome: "network" }),
    false,
  );
  assert.equal(
    shouldClearSessionAfterMeFailure({ status: 500, accessTokenStillPresent: true, refreshOutcome: "none" }),
    false,
  );
  assert.equal(
    shouldClearSessionAfterMeFailure({ status: undefined, accessTokenStillPresent: true, refreshOutcome: "none" }),
    false,
  );
  assert.equal(
    shouldClearSessionAfterMeFailure({ status: 403, accessTokenStillPresent: true, refreshOutcome: "none", tokenRole: "patient" }),
    true,
  );
  assert.equal(
    shouldClearSessionAfterMeFailure({ status: 403, accessTokenStillPresent: true, refreshOutcome: "none", tokenRole: "laboratory" }),
    false,
  );
  assert.equal(STAFF_SESSION_KEYS.some((key) => (PORTAL_SESSION_KEYS as readonly string[]).includes(key)), false);
});

test("role restored from the access token matches the server role claim", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ role: "super_admin", sub: "???" })).toString("base64url");
  assert.match(body, /[-_]/);
  assert.equal(roleFromAccessTokenPayload(`${header}.${body}.sig`), "super_admin");
  assert.equal(roleFromAccessTokenPayload(`${header}.${Buffer.from(JSON.stringify({ role: "physician" })).toString("base64url")}.sig`), "physician");
});

test("live password reset, patient preselect, and attending assignment", async () => {
  assert.equal(loadDbConfig().database, "ACE_ResultsPortal");
  await initDb();
  liveServer = app.listen(0);
  const address = liveServer.address() as AddressInfo;
  api = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${api}/api/healthz`);
  assert.equal(health.status, 200);

  const adminUser = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  assert.ok(adminPassword, "ADMIN_BOOTSTRAP_PASSWORD is required for the live reset");

  const initialPhysicianPassword = `HwfInit${stamp}a!`;
  const labPassword = `HwfLab${stamp}a!`;
  const accessHash = await hashPassword(`HwfAccess${stamp}a!`);
  const physicianHash = await hashPassword(initialPhysicianPassword);
  const labHash = await hashPassword(labPassword);

  const physician = await usersRepo.insertUser({
    username: physicianUsername,
    passwordHash: physicianHash,
    firstName: "Hwf",
    lastName: "Physician",
    email: null,
    role: "physician",
  });
  physicianId = physician.id;

  const labStaff = await usersRepo.insertUser({
    username: labUsername,
    passwordHash: labHash,
    firstName: "Hwf",
    lastName: "Lab",
    email: null,
    role: "laboratory",
  });
  labStaffId = labStaff.id;

  const patient = await patientsRepo.insertPatient({
    patientHisId,
    lastName: "Workflow",
    firstName: "Hospital",
    middleName: null,
    dateOfBirth: "1991-05-05",
    mobileNumber: null,
    email: null,
    accessCodeHash: accessHash,
    createdById: null,
  });
  patientId = patient.id;

  const adminLogin = await post("/api/auth/login", { username: adminUser, password: adminPassword, portal: "admin" });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
  const adminToken = String(adminLogin.data.accessToken);

  const listed = await get(`/api/users?search=${encodeURIComponent(physicianUsername)}&limit=20`, adminToken);
  assert.equal(listed.status, 200);
  const accounts = (listed.data.data ?? []) as Array<{ id: number; username: string; role: string; isActive: boolean }>;
  const listedPhysician = accounts.find((account) => account.username === physicianUsername);
  assert.ok(listedPhysician, "active physician search did not return the temporary physician");
  assert.equal(listedPhysician.role, "physician");
  assert.equal(listedPhysician.isActive, true);
  assert.equal(listedPhysician.id, physicianId);

  const previousPassword = `AceHold${stamp.toString(36)}a!`;
  const nextPassword = `AceHold${stamp.toString(36)}b!`;
  const firstReset = await post(`/api/users/${physicianId}/reset-password`, { newPassword: previousPassword }, adminToken);
  assert.equal(firstReset.status, 200);
  assert.equal(firstReset.data.message, "Password reset successfully");
  assert.equal(JSON.stringify(firstReset.data).includes("password_hash"), false);
  assert.equal(JSON.stringify(firstReset.data).includes(previousPassword), false);

  const firstLogin = await post("/api/auth/login", { username: physicianUsername, password: previousPassword, portal: "doctor" });
  assert.equal(firstLogin.status, 200);
  assert.equal((firstLogin.data.user as { role: string }).role, "physician");
  assert.equal((firstLogin.data.user as { isActive: boolean }).isActive, true);

  const secondReset = await post(`/api/users/${physicianId}/reset-password`, { newPassword: nextPassword }, adminToken);
  assert.equal(secondReset.status, 200);
  const oldLogin = await post("/api/auth/login", { username: physicianUsername, password: previousPassword, portal: "doctor" });
  assert.equal(oldLogin.status, 401);
  const newLogin = await post("/api/auth/login", { username: physicianUsername, password: nextPassword, portal: "doctor" });
  assert.equal(newLogin.status, 200);
  const restored = newLogin.data.user as { role: string; isActive: boolean };
  assert.equal(restored.role, "physician");
  assert.equal(restored.isActive, true);
  const me = await get("/api/auth/me", String(newLogin.data.accessToken));
  assert.equal(me.status, 200);
  assert.equal((me.data.role as string) ?? (me.data.user as { role?: string } | undefined)?.role, "physician");

  const denied = await post(
    `/api/users/${physicianId}/reset-password`,
    { newPassword: "NotAllowed1!" },
    String(newLogin.data.accessToken),
  );
  assert.equal(denied.status, 403);

  const staffLogin = await post("/api/auth/login", { username: labUsername, password: labPassword, portal: "staff" });
  assert.equal(staffLogin.status, 200);
  assert.equal((staffLogin.data.user as { role: string }).role, "laboratory");
  const blocked = await post(
    `/api/patients/${patientId}/physicians`,
    { physicianId },
    String(staffLogin.data.accessToken),
  );
  assert.equal(blocked.status, 403);

  const before = await get(`/api/patients?search=${encodeURIComponent(patientHisId)}&limit=20`, adminToken);
  assert.equal(before.status, 200);
  const totalBefore = before.data.total as number;
  const listedPatient = ((before.data.data ?? []) as Array<{ id: number; patientHisId: string; lastName: string; firstName: string }>).find(
    (row) => row.id === patientId,
  );
  assert.ok(listedPatient, "a patient record is required to verify preselect");
  const loaded = await get(`/api/patients/${patientId}`, adminToken);
  assert.equal(loaded.status, 200);
  const loadedPatient = loaded.data as { id: number; patientHisId: string; lastName: string; firstName: string };
  assert.equal(loadedPatient.id, patientId);
  assert.equal(patientPrefillId(String(patientId)), patientId);
  assert.deepEqual(uploadSelectionFromPatient(loadedPatient).id, patientId);
  assert.equal(registrationUploadPath(patientId).includes("access"), false);
  const afterList = await get(`/api/patients?search=${encodeURIComponent(patientHisId)}&limit=20`, adminToken);
  assert.equal(afterList.data.total, totalBefore);

  const assignedBefore = await get(`/api/patients/${patientId}/physicians`, adminToken);
  assert.equal(assignedBefore.status, 200);
  const beforeIds = (assignedBefore.data as Array<{ id: number }>).map((row) => row.id);
  const found = await get(`/api/physicians?search=${encodeURIComponent(physicianUsername)}`, adminToken);
  assert.equal(found.status, 200);
  const match = (found.data as Array<{ id: number; username: string }>).find((row) => row.username === physicianUsername);
  assert.ok(match);
  assert.equal(match.id, physicianId);
  if (beforeIds.includes(match.id)) {
    const duplicate = await post(`/api/patients/${patientId}/physicians`, { physicianId: match.id }, adminToken);
    assert.equal(duplicate.status, 409);
  } else {
    const added = await post(`/api/patients/${patientId}/physicians`, { physicianId: match.id }, adminToken);
    assert.equal(added.status, 201);
    const assignedAfter = await get(`/api/patients/${patientId}/physicians`, adminToken);
    const afterIds = (assignedAfter.data as Array<{ id: number }>).map((row) => row.id);
    for (const id of beforeIds) assert.equal(afterIds.includes(id), true);
    assert.equal(afterIds.includes(match.id), true);
    const duplicate = await post(`/api/patients/${patientId}/physicians`, { physicianId: match.id }, adminToken);
    assert.equal(duplicate.status, 409);
    const still = await get(`/api/patients/${patientId}/physicians`, adminToken);
    assert.equal((still.data as unknown[]).length, afterIds.length);
  }

  const outfile = join(tmpdir(), "ace-phase-h-reset.json");
  writeFileSync(
    outfile,
    JSON.stringify({
      httpStatus: secondReset.status,
      response: secondReset.data,
      oldPasswordRejected: oldLogin.status === 401,
      newPasswordAccepted: newLogin.status === 200,
      role: restored.role,
      isActive: restored.isActive,
      previousPassword,
      nextPassword,
      physicianId,
    }),
  );
  console.log(`PHASE_H_RESET_FILE=${outfile}`);
});

async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

async function get(path: string, token: string) {
  const response = await fetch(`${api}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

after(async () => {
  try {
    const pool = await getPool();
    if (patientId > 0) {
      await pool.request().input("id", sql.Int, patientId).query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, patientId).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, patientId).query("DELETE FROM dbo.patients WHERE id = @id").catch(() => undefined);
    }
    // Only revoke/delete rows owned by this test's temporary users — never the admin bootstrap account.
    for (const id of [physicianId, labStaffId].filter((value) => value > 0)) {
      await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
    }
  } finally {
    await new Promise<void>((resolve) => {
      if (!liveServer) {
        resolve();
        return;
      }
      liveServer.close(() => resolve());
    });
    await closePool().catch(() => undefined);
  }
});
