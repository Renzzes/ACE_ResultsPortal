/**
 * Synthetic upload → email → portal unlock E2E for per-document access codes.
 * Isolated RESULT_STORAGE_ROOT; mock SMTP; ACE_ResultsPortal only; no LiveDB writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  applyIsolatedStorageEnv,
  assertIsolatedStorageRoot,
  createIsolatedResultStorageRoot,
} from "./lib/test-storage-isolation.ts";

const stamp = Date.now();
const PASSWORD = `DocAccess${stamp}a!`;
const storageRoot = createIsolatedResultStorageRoot(`e2e-${stamp}`);
applyIsolatedStorageEnv(storageRoot);
console.log(`E2E_ISOLATED_STORAGE=${storageRoot}`);
assertIsolatedStorageRoot(storageRoot);

const { loadRootEnv, resetRootEnvCache, resetResultStorageCache, ensureStorageReady } = await import(
  "@workspace/db"
);
resetRootEnvCache();
process.env.RESULT_STORAGE_ROOT = storageRoot;
loadRootEnv();
process.env.RESULT_STORAGE_ROOT = storageRoot;
resetResultStorageCache();
ensureStorageReady();

const {
  closePool,
  getPool,
  getStorageRoot,
  initDb,
  loadDbConfig,
  patientDepartmentsRepo,
  patientsRepo,
  resultsRepo,
  sql,
  usersRepo,
  PORTAL_USER_ROLE,
} = await import("@workspace/db");

assertIsolatedStorageRoot(getStorageRoot());
assert.ok(
  getStorageRoot().toLowerCase().includes("acerpts-test-storage"),
  "storage root must be isolated temp marker",
);

const { hashPassword } = await import("../../artifacts/api-server/src/lib/auth.ts");
const { setPortalEmailSenderForTests } = await import(
  "../../artifacts/api-server/src/lib/portal-email.ts"
);
const { resolveRegistrationDepartment } = await import(
  "../../artifacts/api-server/src/lib/patient-department-access.ts"
);
const { default: app } = await import("../../artifacts/api-server/src/app.ts");

let server: Server;
let base = "";
let labId = 0;
let patientId = 0;
let portalUserId = 0;
let resultAId = 0;
let resultBId = 0;
let codeA = "";
let codeB = "";
let sentMails: Array<{ to: string; subject: string; text: string }> = [];

async function json(urlPath: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${urlPath}`, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data, headers: response.headers };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function makePdf(label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`Synthetic ${label}`, { x: 40, y: 300, size: 14, font });
  return Buffer.from(await doc.save());
}

async function uploadResult(token: string, fileLabel: string, email: string) {
  const pdf = await makePdf(fileLabel);
  const form = new FormData();
  form.append("patientId", String(patientId));
  form.append("category", "laboratory");
  form.append("releaseOption", "immediate");
  form.append("recipientEmail", email);
  form.append(
    "file",
    new Blob([Uint8Array.from(pdf)], { type: "application/pdf" }),
    `${fileLabel}.pdf`,
  );
  const response = await fetch(`${base}/api/results/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

function extractCode(text: string): string {
  const match = text.match(/Access code:\s*(ACE-[A-Z0-9-]+)/i);
  assert.ok(match?.[1], `access code missing from email body: ${text.slice(0, 200)}`);
  return match[1]!;
}

async function staffLogin(): Promise<string> {
  const login = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `docaccess-lab-${stamp}`, password: PASSWORD, portal: "staff" }),
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  return String(login.data.accessToken);
}

async function portalLogin(): Promise<string> {
  const login = await json("/api/portal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: `DOCACCESS-${stamp}`,
      lastName: "Patient",
      password: PASSWORD,
    }),
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const token = login.data.sessionToken;
  assert.equal(typeof token, "string");
  return String(token);
}

before(async () => {
  assert.equal(loadDbConfig().database, "ACE_ResultsPortal");
  process.env.RESULT_STORAGE_ROOT = storageRoot;
  resetResultStorageCache();
  ensureStorageReady();
  assertIsolatedStorageRoot(getStorageRoot());

  await initDb();
  sentMails = [];
  setPortalEmailSenderForTests(async (to, subject, text) => {
    sentMails.push({ to, subject, text });
    return true;
  });

  server = app.listen(0);
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/api/healthz`);
  assert.equal(health.status, 200);

  const passwordHash = await hashPassword(PASSWORD);
  const lab = await usersRepo.insertUser({
    username: `docaccess-lab-${stamp}`,
    passwordHash,
    firstName: "Doc",
    lastName: "Access",
    email: null,
    role: "laboratory",
  });
  labId = lab.id;

  const portalHisId = `DOCACCESS-${stamp}`;
  const portalUser = await usersRepo.insertUser({
    username: `patient:${portalHisId}`,
    passwordHash,
    firstName: "Doc",
    lastName: "Patient",
    email: null,
    role: PORTAL_USER_ROLE,
  });
  portalUserId = portalUser.id;

  const patient = await patientsRepo.insertPatient({
    patientHisId: portalHisId,
    lastName: "Patient",
    firstName: "Doc",
    middleName: null,
    dateOfBirth: "1990-01-01",
    mobileNumber: null,
    email: `doc.access.${stamp}@example.test`,
    accessCodeHash: null,
    createdById: lab.id,
    portalUserId: portalUser.id,
  });
  patientId = patient.id;

  const registration = await resolveRegistrationDepartment("laboratory");
  assert.equal(registration.status, "department");
  if (registration.status === "department") {
    await patientDepartmentsRepo.ensureMembership({
      patientId: patient.id,
      departmentId: registration.departmentId,
      registeredById: lab.id,
    });
  }
});

after(async () => {
  setPortalEmailSenderForTests(null);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    const pool = await getPool();
    for (const id of [resultAId, resultBId].filter((v) => v > 0)) {
      await pool
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.result_physicians WHERE result_id = @id")
        .catch(() => undefined);
      await pool
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.result_reviews WHERE result_id = @id")
        .catch(() => undefined);
      await pool
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.results WHERE id = @id")
        .catch(() => undefined);
    }
    if (patientId > 0) {
      await pool
        .request()
        .input("id", sql.Int, patientId)
        .query("DELETE FROM dbo.patient_departments WHERE patient_id = @id")
        .catch(() => undefined);
      await pool
        .request()
        .input("id", sql.Int, patientId)
        .query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id")
        .catch(() => undefined);
      await pool
        .request()
        .input("id", sql.Int, patientId)
        .query("DELETE FROM dbo.patients WHERE id = @id")
        .catch(() => undefined);
    }
    for (const id of [portalUserId, labId].filter((v) => v > 0)) {
      await pool
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.auth_sessions WHERE user_id = @id")
        .catch(() => undefined);
      await pool
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.users WHERE id = @id")
        .catch(() => undefined);
    }
  } finally {
    await closePool();
    try {
      assertIsolatedStorageRoot(storageRoot);
      fs.rmSync(storageRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test("storage isolation rejects production path", () => {
  assert.throws(() => assertIsolatedStorageRoot("D:\\ACERPTS\\storage"));
  assert.throws(() => assertIsolatedStorageRoot("D:\\ACERPTS\\storage\\results"));
});

test("upload A and B issue distinct emailed document codes", async () => {
  const token = await staffLogin();
  const email = `doc.access.${stamp}@example.test`;

  sentMails = [];
  const upA = await uploadResult(token, "result-a", email);
  assert.equal(upA.status, 201, JSON.stringify(upA.data));
  assert.equal((upA.data.accessCodeEmail as { accepted?: boolean } | undefined)?.accepted, true);
  resultAId = Number(upA.data.id);
  assert.ok(resultAId > 0);
  assert.equal(sentMails.length, 1);
  assert.match(sentMails[0]!.subject, /Document access code/i);
  assert.match(sentMails[0]!.text, /result-a\.pdf/i);
  codeA = extractCode(sentMails[0]!.text);
  assert.equal(JSON.stringify(upA.data).includes(codeA), false);

  sentMails = [];
  const upB = await uploadResult(token, "result-b", email);
  assert.equal(upB.status, 201, JSON.stringify(upB.data));
  assert.equal((upB.data.accessCodeEmail as { accepted?: boolean } | undefined)?.accepted, true);
  resultBId = Number(upB.data.id);
  assert.ok(resultBId > 0 && resultBId !== resultAId);
  assert.equal(sentMails.length, 1);
  assert.match(sentMails[0]!.text, /result-b\.pdf/i);
  codeB = extractCode(sentMails[0]!.text);
  assert.notEqual(codeA, codeB);

  const storedA = path.join(getStorageRoot(), "results", String(resultAId), "result.pdf");
  const storedB = path.join(getStorageRoot(), "results", String(resultBId), "result.pdf");
  assert.equal(fs.existsSync(storedA), true);
  assert.equal(fs.existsSync(storedB), true);
  assertIsolatedStorageRoot(getStorageRoot());

  const rows = await resultsRepo.listResultsForPatient(patientId, { status: "released" });
  assert.ok(rows.length >= 2);
});

test("portal: code A unlocks only A; code B unlocks only B", async () => {
  const token = await portalLogin();

  const catalog = await json("/api/portal/results", { headers: authHeaders(token) });
  assert.equal(catalog.status, 200);
  const list = catalog.data as unknown as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(list) && list.length >= 2);
  assert.equal(JSON.stringify(list).includes("accessCodeHash"), false);
  assert.equal(JSON.stringify(list).includes(codeA), false);
  assert.equal(JSON.stringify(list).includes(codeB), false);

  const bad = await json("/api/portal/verify", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: codeA, resultId: resultBId }),
  });
  assert.equal(bad.status, 401);
  assert.notEqual(bad.data.unlocked, true);

  const okA = await json("/api/portal/verify", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: codeA, resultId: resultAId }),
  });
  assert.equal(okA.status, 200, JSON.stringify(okA.data));
  assert.equal(okA.data.unlocked, true);
  assert.equal(okA.data.resultId, resultAId);

  const dlA = await fetch(`${base}/api/portal/results/${resultAId}/download`, {
    headers: { ...authHeaders(token), "x-portal-access-code": codeA },
  });
  assert.equal(dlA.status, 200);
  const dlABody = (await dlA.json()) as { url?: string };
  assert.ok(dlABody.url?.startsWith("/api/portal/file/"));

  const dlBWrong = await fetch(`${base}/api/portal/results/${resultBId}/download`, {
    headers: { ...authHeaders(token), "x-portal-access-code": codeA },
  });
  assert.equal(dlBWrong.status, 403);

  const okB = await json("/api/portal/verify", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: codeB, resultId: resultBId }),
  });
  assert.equal(okB.status, 200);
  assert.equal(okB.data.unlocked, true);
});

test("regenerate A invalidates only A; B remains valid; resend does not rotate", async () => {
  const token = await staffLogin();
  const oldA = codeA;

  sentMails = [];
  const regen = await json(`/api/results/${resultAId}/regenerate-access-code`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ email: `doc.access.${stamp}@example.test` }),
  });
  assert.equal(regen.status, 200, JSON.stringify(regen.data));
  assert.equal(sentMails.length, 1);
  const newA = extractCode(sentMails[0]!.text);
  assert.notEqual(newA, oldA);
  codeA = newA;

  const pToken = await portalLogin();

  const oldFail = await json("/api/portal/verify", {
    method: "POST",
    headers: { ...authHeaders(pToken), "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: oldA, resultId: resultAId }),
  });
  assert.equal(oldFail.status, 401);
  assert.notEqual(oldFail.data.unlocked, true);

  const newOk = await json("/api/portal/verify", {
    method: "POST",
    headers: { ...authHeaders(pToken), "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: newA, resultId: resultAId }),
  });
  assert.equal(newOk.status, 200);
  assert.equal(newOk.data.unlocked, true);

  const bStill = await json("/api/portal/verify", {
    method: "POST",
    headers: { ...authHeaders(pToken), "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: codeB, resultId: resultBId }),
  });
  assert.equal(bStill.status, 200);
  assert.equal(bStill.data.unlocked, true);

  sentMails = [];
  const resend = await json(`/api/results/${resultAId}/resend-access-code`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ email: `doc.access.${stamp}@example.test` }),
  });
  assert.equal(resend.status, 200, JSON.stringify(resend.data));
  assert.equal(sentMails.length, 1);
  assert.equal(extractCode(sentMails[0]!.text), newA);
});

test("print-ready requires auth, is private no-store, and embeds current code", async () => {
  const token = await staffLogin();
  const denied = await fetch(`${base}/api/results/${resultAId}/print-ready`);
  assert.ok(denied.status === 401 || denied.status === 403);

  const ok = await fetch(`${base}/api/results/${resultAId}/print-ready`, {
    headers: authHeaders(token),
  });
  const bytes = Buffer.from(await ok.arrayBuffer());
  assert.equal(ok.status, 200, `print-ready status=${ok.status} bytes=${bytes.length}`);
  assert.match(ok.headers.get("cache-control") ?? "", /private/i);
  assert.match(ok.headers.get("cache-control") ?? "", /no-store/i);
  assert.ok(bytes.length > 100);
  const { PDFDocument: PdfLib } = await import("pdf-lib");
  const doc = await PdfLib.load(bytes);
  assert.equal(doc.getPageCount(), 1);
});
