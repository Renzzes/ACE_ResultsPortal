/**
 * Portal password and diagnostic access code stay separate.
 * The database probe inserts one patient without a portal user and deletes it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { closePool, initDb, loadRootEnv, patientsRepo } from "@workspace/db";
import { hashAccessCode, signAccessToken } from "../../artifacts/api-server/src/lib/auth.js";
import { copyText } from "../../artifacts/ace-results-portal/src/lib/copy-text.ts";
import { request, sql } from "../../lib/db/src/pool.ts";

loadRootEnv();
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = "test-jwt-secret-for-portal-access-login-32";
}

after(async () => {
  await closePool();
});

const root = new URL("../../", import.meta.url);
const probeHisId = "ZZ-ACCESS-LOGIN-PROBE";
const probeLastName = "QUINAN";
const probeCode = "ACE-PROBE-CODE";

function readRepo(relativePath: string) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

test("copy uses the clipboard api when it is available", async () => {
  const copied: string[] = [];
  const ok = await copyText("ACE-PROBE-CODE", {
    writeText: async (value) => {
      copied.push(value);
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(copied, ["ACE-PROBE-CODE"]);
});

test("copy falls back when the clipboard api is missing and removes the textarea", async () => {
  let removed = false;
  const ok = await copyText("ACE-PROBE-CODE", {
    writeText: null,
    body: { appendChild() {} },
    createTextarea: () => ({
      value: "",
      style: { position: "", left: "" },
      setAttribute() {},
      select() {},
      remove() {
        removed = true;
      },
    }),
    execCommand: (command) => command === "copy",
  });
  assert.equal(ok, true);
  assert.equal(removed, true);
});

test("copy falls back when the clipboard api rejects", async () => {
  let removed = false;
  const ok = await copyText("ACE-PROBE-CODE", {
    writeText: async () => {
      throw new Error("insecure");
    },
    body: { appendChild() {} },
    createTextarea: () => ({
      value: "",
      style: { position: "", left: "" },
      setAttribute() {},
      select() {},
      remove() {
        removed = true;
      },
    }),
    execCommand: () => true,
  });
  assert.equal(ok, true);
  assert.equal(removed, true);
});

test("copy failure is visible to the caller when both methods fail", async () => {
  const ok = await copyText("ACE-PROBE-CODE", {
    writeText: async () => {
      throw new Error("blocked");
    },
    body: { appendChild() {} },
    createTextarea: () => ({
      value: "",
      style: { position: "", left: "" },
      setAttribute() {},
      select() {},
      remove() {},
    }),
    execCommand: () => false,
  });
  assert.equal(ok, false);
});

test("login is the portal password and verify stays result unlock", () => {
  const access = readRepo("artifacts/ace-results-portal/src/pages/access.tsx");
  const register = readRepo("artifacts/ace-results-portal/src/pages/register.tsx");
  const route = readRepo("artifacts/api-server/src/routes/portal.ts");
  const staffCreate = readRepo("artifacts/api-server/src/routes/patients.ts");
  const loginStart = route.indexOf('router.post("/portal/login"');
  const loginBlock = route.slice(loginStart, route.indexOf("router.", loginStart + 20));
  assert.match(access, /fetch\("\/api\/portal\/login"/);
  assert.match(access, />\s*Password\s*</);
  assert.doesNotMatch(access, /fetch\("\/api\/portal\/verify"/);
  assert.match(register, /type="button"[\s\S]{0,500}Copy Access Code/);
  assert.match(register, /Unable to copy automatically\. Please copy the access code manually\./);
  assert.match(register, /Your Patient Portal account has been created\./);
  assert.match(register, /password: values\.password/);
  assert.match(route, /router\.post\("\/portal\/verify", requirePortalAuth/);
  assert.doesNotMatch(loginBlock, /compareAccessCode/);
  assert.doesNotMatch(loginBlock, /resolveOrActivatePortalPatientForLogin/);
  assert.match(loginBlock, /comparePassword\(password, resolved\.passwordHash\)/);
  assert.doesNotMatch(staffCreate.slice(staffCreate.indexOf("plaintextCode = generateAccessCode()"), staffCreate.indexOf("accessCode: plaintextCode")), /insertUser/);
  assert.match(readRepo("artifacts/api-server/src/lib/auth.ts"), /sid\?: string/);
  assert.doesNotMatch(readRepo("artifacts/api-server/src/lib/auth.ts"), /accessCode:/);
  const resultsAccess = readRepo("artifacts/ace-results-portal/src/lib/portal-results-access.ts");
  assert.match(resultsAccess, /\/api\/portal\/verify/);
  assert.doesNotMatch(resultsAccess, /localStorage\.setItem/);
  assert.doesNotMatch(resultsAccess, /sessionStorage\.setItem/);
  assert.match(readRepo("artifacts/ace-results-portal/src/lib/auth.tsx"), /portalLogout/);
});

test("a staff-created patient cannot sign in with the access code", async (t) => {
  await initDb();
  const usersBefore = await request().query(`SELECT COUNT(*) AS total FROM dbo.users`);
  const beforeCount = Number((usersBefore.recordset[0] as { total: number }).total);
  const users = await request().query(`SELECT TOP 1 id FROM dbo.users ORDER BY id`);
  const createdById = Number((users.recordset[0] as { id: number } | undefined)?.id);
  await request()
    .input("patientHisId", sql.NVarChar(64), probeHisId)
    .query(`DELETE FROM dbo.patients WHERE patient_his_id = @patientHisId`);
  await patientsRepo.insertPatient({
    patientHisId: probeHisId,
    lastName: probeLastName,
    firstName: "Probe",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: null,
    accessCodeHash: await hashAccessCode(probeCode),
    createdById: Number.isFinite(createdById) ? createdById : null,
    portalUserId: null,
  });

  const api = `http://127.0.0.1:${process.env.PORT ?? "5000"}`;
  try {
    const created = await request()
      .input("patientHisId", sql.NVarChar(64), probeHisId)
      .query(`SELECT portal_user_id FROM dbo.patients WHERE patient_his_id = @patientHisId`);
    assert.equal((created.recordset[0] as { portal_user_id: number | null }).portal_user_id, null);

    let reachable = true;
    try {
      await fetch(`${api}/api/portal/login`, { method: "POST" });
    } catch {
      reachable = false;
    }
    if (!reachable) {
      t.diagnostic("API is not running; HTTP separation was not exercised");
      return;
    }

    const login = await fetch(`${api}/api/portal/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: probeHisId, lastName: probeLastName, password: probeCode }),
    });
    assert.equal(login.status, 401);
    const loginBody = (await login.json()) as Record<string, unknown>;
    assert.equal(loginBody.error, "Invalid credentials");
    assert.equal("sessionToken" in loginBody, false);

    const verify = await fetch(`${api}/api/portal/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientHisId: probeHisId, lastName: probeLastName, accessCode: probeCode }),
    });
    assert.equal(verify.status, 401);

    const staff = await fetch(`${api}/api/portal/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signAccessToken({ userId: 1, username: "staff.probe", role: "laboratory" })}`,
      },
      body: JSON.stringify({ accessCode: probeCode }),
    });
    assert.equal(staff.status, 401);

    const after = await request()
      .input("patientHisId", sql.NVarChar(64), probeHisId)
      .query(`SELECT portal_user_id FROM dbo.patients WHERE patient_his_id = @patientHisId`);
    assert.equal((after.recordset[0] as { portal_user_id: number | null }).portal_user_id, null);
    const usersAfter = await request().query(`SELECT COUNT(*) AS total FROM dbo.users`);
    assert.equal(Number((usersAfter.recordset[0] as { total: number }).total), beforeCount);
  } finally {
    await request()
      .input("patientHisId", sql.NVarChar(64), probeHisId)
      .query(`DELETE FROM dbo.patients WHERE patient_his_id = @patientHisId`);
  }
});
