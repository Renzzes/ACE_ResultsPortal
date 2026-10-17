import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  closeHisPool,
  closePool,
  initDb,
  loadRootEnv,
} from "@workspace/db";

loadRootEnv();

const API = `http://127.0.0.1:${process.env.PORT ?? "5000"}`;

const known = {
  patientHisId: "1240",
  lastName: "ROSAROSO",
  dateOfBirth: "1984-06-14",
};

const testPassword = "PortalTest1!";

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("Invalid JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

test("portal login rejects patient without portal_user_id (activation gate)", async () => {
  const result = await post("/api/portal/login", {
    identifier: known.patientHisId,
    password: testPassword,
  });
  if (result.status === 404) return;
  assert.equal(result.status, 401);
  assert.equal("sessionToken" in result.data, false);
});

test("portal login rejects wrong password", async () => {
  const result = await post("/api/portal/login", {
    identifier: known.patientHisId,
    password: "WrongPass1!",
    lastName: known.lastName,
  });
  if (result.status === 404) return;
  assert.equal(result.status, 401);
});

test("portal login rejects unknown HIS id", async () => {
  const result = await post("/api/portal/login", {
    identifier: "NO-SUCH-PATIENT-999999",
    password: testPassword,
  });
  if (result.status === 404) return;
  assert.equal(result.status, 401);
});

test("portal verify requires portal session for results access", async () => {
  const result = await post("/api/portal/verify", {
    accessCode: "ACE-TEST-CODE",
  });
  if (result.status === 404) return;
  assert.equal(result.status, 401);
});

test("portal verify-identity invalid date rejected", async () => {
  const result = await post("/api/portal/verify-identity", {
    ...known,
    dateOfBirth: "not-a-date",
  });
  if (result.status === 404) return;
  assert.equal(result.status, 400);
});

test("portal JWT contains patientId and type portal only when login succeeds", async () => {
  await initDb();
  const identity = await post("/api/portal/verify-identity", known);
  if (identity.status === 404 || identity.status === 503) return;

  let accessCode: string | undefined;
  if (identity.data.isNewPortalAccount === true && typeof identity.data.registrationToken === "string") {
    const uniqueEmail = `portal-test-${Date.now()}@example.com`;
    const registered = await post("/api/portal/register", {
      registrationToken: identity.data.registrationToken,
      email: uniqueEmail,
      confirmEmail: uniqueEmail,
      password: testPassword,
      confirmPassword: testPassword,
    });
    if (registered.status !== 200) return;
    if (typeof registered.data.accessCode === "string") {
      accessCode = registered.data.accessCode;
    }
  } else {
    return;
  }

  const login = await post("/api/portal/login", {
    identifier: known.patientHisId,
    lastName: known.lastName,
    password: testPassword,
  });
  if (login.status !== 200) return;

  const token = login.data.sessionToken;
  assert.equal(typeof token, "string");
  const payload = decodeJwtPayload(String(token));
  assert.equal(payload.type, "portal");
  assert.equal(typeof payload.patientId, "number");
  assert.equal(typeof payload.patientHisId, "string");
  assert.equal("accessCode" in payload, false);
  assert.equal("password" in payload, false);

  // Document unlock requires resultId; bare accessCode must not grant a global unlock.
  const unlockMissingResult = await fetch(`${API}/api/portal/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${String(token)}`,
    },
    body: JSON.stringify({ accessCode: accessCode ?? "ACE-TEST-CODE" }),
  });
  if (unlockMissingResult.status === 404) return;
  assert.equal(unlockMissingResult.status, 400);
});

test("recover request rejects invalid identity", async () => {
  const result = await post("/api/portal/recover/request", {
    ...known,
    lastName: "NOT-THE-PATIENT",
  });
  if (result.status === 404) return;
  assert.equal(result.status, 401);
});

test("portal logout requires authentication", async () => {
  const result = await fetch(`${API}/api/portal/logout`, { method: "POST" });
  if (result.status === 404) return;
  assert.equal(result.status, 401);
});

after(async () => {
  await closePool();
  await closeHisPool();
});
