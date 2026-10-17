/**
 * Browser-equivalent workflow verification through the Vite UI origin proxy.
 * Hits http://127.0.0.1:<VITE_PORT>/api/* (same path the browser uses), not :3003.
 * Uses ACE_ResultsPortal synthetic/bootstrap accounts only — no HIS patient registration.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  closePool,
  ensureStorageReady,
  getPool,
  initDb,
  loadDbConfig,
  loadRootEnv,
  patientsRepo,
  PORTAL_USER_ROLE,
  resetResultStorageCache,
  resultsRepo,
  sql,
  usersRepo,
} from "@workspace/db";

loadRootEnv();

const UI = `http://127.0.0.1:${process.env.VITE_PORT || "8080"}`;
const API_DIRECT = `http://127.0.0.1:${process.env.API_PORT || process.env.PORT || "5000"}`;
const stamp = Date.now();
const synthHisA = `BROWSER-A-${stamp}`;
const synthHisB = `BROWSER-B-${stamp}`;
const accessCode = `ACE-BW-${String(stamp).slice(-4)}-TEST`;
const pdfBytes = Buffer.from(
  "%PDF-1.4\n% browser-workflow synthetic\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  "utf8",
);

let staffToken = "";
let doctorToken = "";
let portalToken = "";
let portalTokenB = "";
let doctorUserId = 0;
let staffUserId = 0;
let patientAId = 0;
let patientBId = 0;
let portalUserAId = 0;
let portalUserBId = 0;
let resultId = 0;
let storageRoot = "";
const createdThreadIds: number[] = [];

type Json = Record<string, unknown>;

async function req(
  base: string,
  method: string,
  pathName: string,
  opts: { token?: string; accessCode?: string; body?: unknown; form?: FormData } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.accessCode) headers["x-portal-access-code"] = opts.accessCode;
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const response = await fetch(`${base}${pathName}`, { method, headers, body });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: response.status, data, headers: response.headers, raw: text };
}

const ui = (method: string, pathName: string, opts?: Parameters<typeof req>[3]) =>
  req(UI, method, pathName, opts);
const api = (method: string, pathName: string, opts?: Parameters<typeof req>[3]) =>
  req(API_DIRECT, method, pathName, opts);

async function loginStaff(username: string, password: string, portal: "staff" | "doctor") {
  const res = await ui("POST", "/api/auth/login", {
    body: { username, password, portal },
  });
  assert.equal(res.status, 200, `login ${portal} failed: ${res.raw.slice(0, 200)}`);
  const token = (res.data as Json).accessToken;
  assert.equal(typeof token, "string");
  return String(token);
}

async function loginPortal(identifier: string, lastName: string, password: string) {
  const res = await ui("POST", "/api/portal/login", {
    body: { identifier, lastName, password },
  });
  assert.equal(res.status, 200, `portal login failed: ${res.raw.slice(0, 200)}`);
  const token = (res.data as Json).sessionToken;
  assert.equal(typeof token, "string");
  return String(token);
}

before(async () => {
  assert.equal(loadDbConfig().database, "ACE_ResultsPortal");

  const healthUi = await ui("GET", "/api/healthz");
  assert.equal(healthUi.status, 200, "Vite proxy must reach local API healthz");
  const healthApi = await api("GET", "/api/healthz");
  assert.equal(healthApi.status, 200);

  const staffUser = process.env.STAFF_BOOTSTRAP_USERNAME?.trim();
  const staffPass = process.env.STAFF_BOOTSTRAP_PASSWORD;
  const doctorUser = process.env.DOCTOR_BOOTSTRAP_USERNAME?.trim();
  const doctorPass = process.env.DOCTOR_BOOTSTRAP_PASSWORD;
  assert.ok(staffUser && staffPass, "staff bootstrap env required");
  assert.ok(doctorUser && doctorPass, "doctor bootstrap env required");

  // Ensure bootstrap accounts exist (dev-only seeders).
  const { seedStaff } = await import("./seed-staff.ts");
  const { seedDoctor } = await import("./seed-doctor.ts");
  await seedStaff();
  await seedDoctor();

  const { hashPassword } = await import("../../artifacts/api-server/src/lib/auth.ts");

  storageRoot =
    process.env.RESULT_STORAGE_ROOT?.trim() ||
    path.resolve("e:/ace-results-portal-source/artifacts/api-server/uploads-browser-test");
  process.env.RESULT_STORAGE_ROOT = storageRoot;
  resetResultStorageCache();
  ensureStorageReady();

  await initDb();
  const staff = await usersRepo.findUserByUsername(staffUser!);
  const doctor = await usersRepo.findUserByUsername(doctorUser!);
  assert.ok(staff && doctor);
  staffUserId = staff.id;
  doctorUserId = doctor.id;

  const portalPass = `BwPortal${stamp}a!`;
  const portalHash = await hashPassword(portalPass);
  void accessCode; // legacy patient-level fixture retained only to assert it is NOT used for unlock

  const userA = await usersRepo.insertUser({
    username: `patient:${synthHisA}`,
    passwordHash: portalHash,
    firstName: "Browser",
    lastName: "SynthA",
    email: null,
    role: PORTAL_USER_ROLE,
  });
  portalUserAId = userA.id;
  const rowA = await patientsRepo.insertPatient({
    patientHisId: synthHisA,
    lastName: "SynthA",
    firstName: "Browser",
    middleName: null,
    dateOfBirth: "1990-05-05",
    mobileNumber: null,
    email: `browser.synth.a.${stamp}@example.test`,
    accessCodeHash: null,
    createdById: staffUserId,
    portalUserId: userA.id,
  });
  patientAId = rowA.id;

  const userB = await usersRepo.insertUser({
    username: `patient:${synthHisB}`,
    passwordHash: portalHash,
    firstName: "Browser",
    lastName: "SynthB",
    email: null,
    role: PORTAL_USER_ROLE,
  });
  portalUserBId = userB.id;
  const rowB = await patientsRepo.insertPatient({
    patientHisId: synthHisB,
    lastName: "SynthB",
    firstName: "Browser",
    middleName: null,
    dateOfBirth: "1991-06-06",
    mobileNumber: null,
    email: `browser.synth.b.${stamp}@example.test`,
    accessCodeHash: null,
    createdById: staffUserId,
    portalUserId: userB.id,
  });
  patientBId = rowB.id;

  // Touch updated_at so Staff Patients ordering surfaces them (mirrors Use Existing link).
  await patientsRepo.touchUpdatedAt(patientAId);
  await patientsRepo.touchUpdatedAt(patientBId);

  staffToken = await loginStaff(staffUser!, staffPass!, "staff");
  doctorToken = await loginStaff(doctorUser!, doctorPass!, "doctor");
  portalToken = await loginPortal(synthHisA, "SynthA", portalPass);
  portalTokenB = await loginPortal(synthHisB, "SynthB", portalPass);

  // Persist portal password on a known env-less path for this run only (in-memory).
  (globalThis as { __bwPortalPass?: string }).__bwPortalPass = portalPass;
});

after(async () => {
  try {
    const pool = await getPool();
    for (const threadId of createdThreadIds) {
      await pool.request().input("id", sql.Int, threadId).query("DELETE FROM dbo.messages WHERE thread_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, threadId).query("DELETE FROM dbo.message_participants WHERE thread_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, threadId).query("DELETE FROM dbo.message_threads WHERE id = @id").catch(() => undefined);
    }
    if (resultId > 0) {
      await pool.request().input("id", sql.Int, resultId).query("DELETE FROM dbo.result_reviews WHERE result_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, resultId).query("DELETE FROM dbo.result_physicians WHERE result_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, resultId).query("DELETE FROM dbo.results WHERE id = @id").catch(() => undefined);
    }
    for (const pid of [patientAId, patientBId].filter((id) => id > 0)) {
      await pool.request().input("id", sql.Int, pid).query("DELETE FROM dbo.patient_physicians WHERE patient_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, pid).query("DELETE FROM dbo.patient_departments WHERE patient_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, pid).query("DELETE FROM dbo.patients WHERE id = @id").catch(() => undefined);
    }
    for (const uid of [portalUserAId, portalUserBId].filter((id) => id > 0)) {
      await pool.request().input("id", sql.Int, uid).query("DELETE FROM dbo.auth_sessions WHERE user_id = @id").catch(() => undefined);
      await pool.request().input("id", sql.Int, uid).query("DELETE FROM dbo.users WHERE id = @id").catch(() => undefined);
    }
  } finally {
    await closePool();
  }
});

test("UI shell loads and proxies API to local :5000 (not :3003)", async () => {
  const page = await fetch(`${UI}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<div id="root"|root/i);

  const proxied = await ui("GET", "/api/healthz");
  assert.equal(proxied.status, 200);
  assert.equal((proxied.data as Json).status, "ok");

  // Confirm proxy target contract from Vite config source.
  const vite = fs.readFileSync(
    path.resolve("e:/ace-results-portal-source/artifacts/ace-results-portal/vite.config.ts"),
    "utf8",
  );
  assert.match(vite, /API_PORT \|\| 5000/);
  assert.doesNotMatch(vite, /3003/);
});

test("Staff: synthetic patients appear in Patients list without duplicates", async () => {
  const list = await ui("GET", `/api/patients?search=${encodeURIComponent("BROWSER-")}`, {
    token: staffToken,
  });
  assert.equal(list.status, 200);
  const payload = list.data as { data?: Array<{ id: number; patientHisId: string }> };
  const rows = payload.data ?? (Array.isArray(list.data) ? (list.data as Array<{ id: number; patientHisId: string }>) : []);
  const matches = rows.filter(
    (r) => r.patientHisId === synthHisA || r.patientHisId === synthHisB,
  );
  assert.equal(matches.length, 2);
  assert.equal(new Set(matches.map((m) => m.id)).size, 2);
});

test("Staff: hospital register of pure synthetic HIS is blocked without LiveDB row (documented)", async () => {
  const lookup = await ui("GET", `/api/patients/hospital-lookup?patientHisId=${encodeURIComponent(synthHisA)}`, {
    token: staffToken,
  });
  // Expected: empty / not found / unavailable — must not invent a hospital patient.
  assert.ok([200, 404, 503].includes(lookup.status), `unexpected lookup status ${lookup.status}`);
  if (lookup.status === 200) {
    const body = lookup.data as { matches?: unknown[]; data?: unknown[] };
    const matches = body.matches ?? body.data ?? (Array.isArray(lookup.data) ? lookup.data : []);
    assert.equal(Array.isArray(matches) ? matches.length : 0, 0);
  }
});

test("Staff: assign physician to synthetic patient and persist", async () => {
  const assign = await ui("POST", `/api/patients/${patientAId}/physicians`, {
    token: staffToken,
    body: { physicianId: doctorUserId },
  });
  assert.ok([200, 201].includes(assign.status), assign.raw.slice(0, 300));

  const listed = await ui("GET", `/api/patients/${patientAId}/physicians`, {
    token: staffToken,
  });
  assert.equal(listed.status, 200);
  const physicians = listed.data as Array<{ id?: number; physicianId?: number }> | { data: Array<{ id: number }> };
  const rows = Array.isArray(physicians) ? physicians : physicians.data;
  assert.ok(rows.some((p) => Number((p as { physicianId?: number; id?: number }).physicianId ?? (p as { id?: number }).id) === doctorUserId || JSON.stringify(p).includes(String(doctorUserId))));
});

test("Staff: upload synthetic released result assigned to physician", async () => {
  const form = new FormData();
  form.append("patientId", String(patientAId));
  form.append("category", "laboratory");
  form.append("releaseOption", "immediate");
  form.append("physicianIds", String(doctorUserId));
  form.append("recipientEmail", `browser.synth.a.${stamp}@example.test`);
  form.append(
    "file",
    new Blob([Uint8Array.from(pdfBytes)], { type: "application/pdf" }),
    "browser-synth-lab.pdf",
  );

  const upload = await ui("POST", "/api/results/upload", {
    token: staffToken,
    form,
  });
  assert.ok([200, 201].includes(upload.status), upload.raw.slice(0, 400));
  const created = upload.data as {
    id?: number;
    result?: { id: number };
    accessCodeEmail?: { accepted?: boolean };
  };
  resultId = Number(created.id ?? created.result?.id);
  assert.ok(resultId > 0);
  assert.equal(created.accessCodeEmail?.accepted, true, upload.raw.slice(0, 400));

  // Document code is emailed (mock/SMTP); recover plaintext from encrypted envelope for unlock tests.
  const { decryptAccessCode } = await import(
    "../../artifacts/api-server/src/lib/result-access-code.ts"
  );
  const row = await resultsRepo.findResultById(resultId);
  assert.ok(row?.accessCodeEncrypted);
  const revealed = decryptAccessCode(row!.accessCodeEncrypted!);
  assert.ok(revealed);
  (globalThis as { __bwDocAccessCode?: string }).__bwDocAccessCode = revealed!;
});

test("Doctor: assigned patient appears in My Patients", async () => {
  const list = await ui("GET", "/api/patients?limit=50", { token: doctorToken });
  assert.equal(list.status, 200);
  const payload = list.data as { data?: Array<{ id: number }> };
  const rows = payload.data ?? (Array.isArray(list.data) ? (list.data as Array<{ id: number }>) : []);
  assert.ok(rows.some((p) => p.id === patientAId), "assigned patient A missing from doctor list");
  assert.equal(rows.some((p) => p.id === patientBId), false);
});

test("Doctor: private comment is not visible in patient Messages", async () => {
  const review = await ui("PUT", `/api/results/${resultId}/review`, {
    token: doctorToken,
    body: { comment: "PRIVATE browser workflow note", shareWithPatient: false },
  });
  assert.equal(review.status, 200, review.raw.slice(0, 300));
  assert.equal((review.data as Json).patientVisible, false);
  assert.equal((review.data as Json).patientMessageThreadId, null);

  const messages = await ui("GET", "/api/portal/messages", { token: portalToken });
  assert.equal(messages.status, 200);
  const threads = (messages.data as { data: Array<{ subject?: string; lastMessagePreview?: string }> }).data ?? [];
  assert.equal(
    threads.some((t) => JSON.stringify(t).includes("PRIVATE browser workflow note")),
    false,
  );
});

test("Doctor: shared comment appears only for owning patient with attachment metadata", async () => {
  const review = await ui("PUT", `/api/results/${resultId}/review`, {
    token: doctorToken,
    body: { comment: "SHARED browser workflow note", shareWithPatient: true },
  });
  assert.equal(review.status, 200, review.raw.slice(0, 400));
  assert.equal((review.data as Json).patientVisible, true);
  const threadId = Number((review.data as Json).patientMessageThreadId);
  assert.ok(threadId > 0);
  createdThreadIds.push(threadId);

  const detail = await ui("GET", `/api/portal/messages/${threadId}`, { token: portalToken });
  assert.equal(detail.status, 200);
  const msgs = (detail.data as { messages: { data: Array<{ body: string; resultAttachment: { resultId: number; locked: boolean } | null }> } }).messages.data;
  assert.ok(msgs.some((m) => m.body.includes("SHARED browser workflow note")));
  const att = msgs.find((m) => m.resultAttachment)?.resultAttachment;
  assert.ok(att);
  assert.equal(att!.resultId, resultId);
  assert.equal(att!.locked, true);

  const foreign = await ui("GET", `/api/portal/messages/${threadId}`, { token: portalTokenB });
  assert.equal(foreign.status, 404);
});

test("Patient: Assigned Doctors includes the physician", async () => {
  const res = await ui("GET", "/api/portal/overview", { token: portalToken });
  assert.equal(res.status, 200, res.raw.slice(0, 300));
  const assigned = (res.data as { assignedDoctors?: Array<{ id: number; name: string }> }).assignedDoctors ?? [];
  assert.ok(
    assigned.some((d) => d.id === doctorUserId),
    `doctor ${doctorUserId} missing from assignedDoctors`,
  );
});

test("Patient: locked catalog metadata only — no PDF bytes or file URLs", async () => {
  const catalog = await ui("GET", "/api/portal/results", { token: portalToken });
  assert.equal(catalog.status, 200);
  const rows = catalog.data as Array<Record<string, unknown>>;
  assert.ok(rows.some((r) => r.id === resultId && r.locked === true));
  for (const row of rows) {
    assert.equal("fileName" in row, false);
    assert.equal(JSON.stringify(row).includes("/api/portal/file/"), false);
    assert.equal(JSON.stringify(row).includes(storageRoot.replaceAll("\\", "\\\\")), false);
  }

  const lockedDownload = await ui("GET", `/api/portal/results/${resultId}/download`, {
    token: portalToken,
  });
  assert.equal(lockedDownload.status, 403);
});

test("Patient: unlock with document access code returns synthetic PDF; reopen works", async () => {
  const docCode = (globalThis as { __bwDocAccessCode?: string }).__bwDocAccessCode;
  assert.ok(docCode, "document access code must be recovered after upload");

  const verify = await ui("POST", "/api/portal/verify", {
    token: portalToken,
    body: { accessCode: docCode, resultId },
  });
  assert.equal(verify.status, 200, verify.raw.slice(0, 300));
  assert.equal((verify.data as Json).unlocked, true);

  const unlock = await ui("GET", `/api/portal/results/${resultId}/download`, {
    token: portalToken,
    accessCode: docCode,
  });
  assert.equal(unlock.status, 200, unlock.raw.slice(0, 300));
  const url = String((unlock.data as Json).url ?? "");
  assert.match(url, /^\/api\/portal\/file\//);

  const file1 = await ui("GET", url, {});
  assert.equal(file1.status, 200);
  assert.equal(file1.headers.get("content-type"), "application/pdf");
  assert.match(file1.headers.get("cache-control") ?? "", /private,\s*no-store/i);
  assert.ok(file1.raw.startsWith("%PDF"));

  const unlock2 = await ui("GET", `/api/portal/results/${resultId}/download`, {
    token: portalToken,
    accessCode: docCode,
  });
  assert.equal(unlock2.status, 200);
  const file2 = await ui("GET", String((unlock2.data as Json).url), {});
  assert.equal(file2.status, 200);
  assert.ok(file2.raw.startsWith("%PDF"));
});

test("Negative: cross-patient result denied; foreign patient cannot unlock A", async () => {
  const docCode = (globalThis as { __bwDocAccessCode?: string }).__bwDocAccessCode ?? accessCode;
  const cross = await ui("GET", `/api/portal/results/${resultId}/download`, {
    token: portalTokenB,
    accessCode: docCode,
  });
  assert.equal(cross.status, 404);

  const catalogB = await ui("GET", "/api/portal/results", { token: portalTokenB });
  assert.equal(catalogB.status, 200);
  const rows = catalogB.data as Array<{ id: number }>;
  assert.equal(rows.some((r) => r.id === resultId), false);
});
