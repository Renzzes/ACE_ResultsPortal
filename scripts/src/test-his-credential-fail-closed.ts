import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadDbConfig } from "../../lib/db/src/config.ts";
import { loadHisDbConfig } from "../../lib/db/src/his-pool.ts";
import { validateProductionEnvFile } from "../validate-production-env.mjs";

const CRED_KEYS = [
  "DB_SERVER",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_DATABASE",
  "HOSPITAL_DB_DATABASE",
  "HIS_DB_DATABASE",
  "HIS_DB_USER",
  "HIS_DB_PASSWORD",
  "HIS_DB_SERVER",
  "HIS_DB_PORT",
] as const;

const saved: Partial<Record<(typeof CRED_KEYS)[number], string | undefined>> = {};

function snapshotEnv(): void {
  for (const key of CRED_KEYS) {
    saved[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of CRED_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearCredEnv(): void {
  for (const key of CRED_KEYS) {
    delete process.env[key];
  }
}

function setPortalAndHospitalBase(): void {
  process.env.DB_SERVER = "127.0.0.1";
  process.env.DB_PORT = "1433";
  process.env.DB_USER = "portal_app_user";
  process.env.DB_PASSWORD = "portal-secret-value";
  process.env.DB_DATABASE = "ACE_ResultsPortal";
  process.env.HOSPITAL_DB_DATABASE = "LiveDB_ACE";
}

snapshotEnv();

test.after(() => {
  restoreEnv();
});

test("missing HIS_DB_USER fails closed without portal fallback", () => {
  clearCredEnv();
  setPortalAndHospitalBase();
  process.env.HIS_DB_PASSWORD = "his-secret-value";
  delete process.env.HIS_DB_USER;

  assert.throws(() => loadHisDbConfig(), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /HIS_DB_USER is required/);
    assert.ok(!err.message.includes("portal-secret-value"));
    assert.ok(!err.message.includes("his-secret-value"));
    return true;
  });
});

test("empty HIS_DB_USER fails closed", () => {
  clearCredEnv();
  setPortalAndHospitalBase();
  process.env.HIS_DB_USER = "   ";
  process.env.HIS_DB_PASSWORD = "his-secret-value";

  assert.throws(() => loadHisDbConfig(), /HIS_DB_USER is required/);
});

test("missing HIS_DB_PASSWORD fails closed without portal fallback", () => {
  clearCredEnv();
  setPortalAndHospitalBase();
  process.env.HIS_DB_USER = "ace_results_his_ro";
  delete process.env.HIS_DB_PASSWORD;

  assert.throws(() => loadHisDbConfig(), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /HIS_DB_PASSWORD is required/);
    assert.ok(!err.message.includes("portal-secret-value"));
    return true;
  });
});

test("empty HIS_DB_PASSWORD fails closed", () => {
  clearCredEnv();
  setPortalAndHospitalBase();
  process.env.HIS_DB_USER = "ace_results_his_ro";
  process.env.HIS_DB_PASSWORD = "";

  assert.throws(() => loadHisDbConfig(), /HIS_DB_PASSWORD is required/);
});

test("HIS credentials are used independently of portal credentials", () => {
  clearCredEnv();
  setPortalAndHospitalBase();
  process.env.HIS_DB_USER = "ace_results_his_ro";
  process.env.HIS_DB_PASSWORD = "his-secret-value";

  const portal = loadDbConfig();
  const his = loadHisDbConfig();

  assert.equal(portal.user, "portal_app_user");
  assert.equal(portal.password, "portal-secret-value");
  assert.equal(portal.database, "ACE_ResultsPortal");
  assert.equal(his.user, "ace_results_his_ro");
  assert.equal(his.password, "his-secret-value");
  assert.equal(his.database, "LiveDB_ACE");
  assert.notEqual(his.user, portal.user);
  assert.notEqual(his.password, portal.password);
});

test("HIS database name cannot equal portal database name", () => {
  clearCredEnv();
  setPortalAndHospitalBase();
  process.env.HOSPITAL_DB_DATABASE = "ACE_ResultsPortal";
  process.env.HIS_DB_USER = "ace_results_his_ro";
  process.env.HIS_DB_PASSWORD = "his-secret-value";

  assert.throws(() => loadHisDbConfig(), /HOSPITAL_DB_UNAVAILABLE/);
});

test("production validation requires non-empty HIS credentials", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acerpts-his-env-"));
  const base = `
PORT=3003
HOST=127.0.0.1
NODE_ENV=production
CORS_ORIGIN=https://example.invalid
JWT_SECRET=${"j".repeat(32)}
DB_SERVER=127.0.0.1
DB_PORT=1433
DB_USER=portal_app_user
DB_PASSWORD=portal-secret-value
DB_DATABASE=ACE_ResultsPortal
HOSPITAL_DB_DATABASE=LiveDB_ACE
RESULT_STORAGE_ROOT=${dir.replace(/\\/g, "/")}
SMTP_HOST=127.0.0.1
SMTP_PORT=25
SMTP_USER=smtp-user
SMTP_PASS=smtp-pass
PORTAL_EMAIL_FROM=noreply@example.invalid
`;

  const missingUser = path.join(dir, "missing-user.env");
  fs.writeFileSync(
    missingUser,
    `${base}\nHIS_DB_PASSWORD=his-secret-value\n`,
    "utf8",
  );
  const missingUserResult = validateProductionEnvFile(missingUser, { silent: true });
  assert.equal(missingUserResult.ok, false);
  assert.ok(missingUserResult.missingRequired.includes("HIS_DB_USER"));

  const emptyPassword = path.join(dir, "empty-password.env");
  fs.writeFileSync(
    emptyPassword,
    `${base}\nHIS_DB_USER=ace_results_his_ro\nHIS_DB_PASSWORD=\n`,
    "utf8",
  );
  const emptyPasswordResult = validateProductionEnvFile(emptyPassword, { silent: true });
  assert.equal(emptyPasswordResult.ok, false);
  assert.ok(emptyPasswordResult.emptyRequired.includes("HIS_DB_PASSWORD"));

  const complete = path.join(dir, "complete.env");
  fs.writeFileSync(
    complete,
    `${base}\nHIS_DB_USER=ace_results_his_ro\nHIS_DB_PASSWORD=his-secret-value\n`,
    "utf8",
  );
  const completeResult = validateProductionEnvFile(complete, { silent: true });
  assert.equal(completeResult.ok, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("check-his-env-nonempty rejects empty HIS credentials by name only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acerpts-his-check-"));
  const emptyFile = path.join(dir, "empty.env");
  fs.writeFileSync(emptyFile, "HIS_DB_USER=\nHIS_DB_PASSWORD=x\n", "utf8");

  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../check-his-env-nonempty.mjs",
  );
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [script, emptyFile], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /HIS_DB_USER/);
  assert.ok(!result.stdout.includes("his-secret"));
  assert.equal(result.stdout.includes("="), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
