/**
 * Phase 6D-1.1 — Patient Portal activation gate unit tests.
 * Uses mocked user lookups only. Does not write to ACE_ResultsPortal or LiveDB_ACE.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@workspace/db";
import { resolveActivePortalAccount } from "../../artifacts/api-server/src/lib/portal-activation.js";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 500,
    username: "patient:TEST-HIS",
    passwordHash: "unused",
    firstName: "Portal",
    lastName: "Patient",
    email: "portal@example.com",
    role: "patient",
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("TEST 1 — portal_user_id NULL denies activation", async () => {
  const result = await resolveActivePortalAccount(
    { portalUserId: null },
    { findUserById: async () => fakeUser() },
  );
  assert.equal(result.ok, false);
});

test("TEST 2 — valid portal_user_id with role=patient and active allows activation", async () => {
  const user = fakeUser({ id: 501, role: "patient", isActive: true });
  const result = await resolveActivePortalAccount(
    { portalUserId: 501 },
    { findUserById: async (id) => (id === 501 ? user : undefined) },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.id, 501);
});

test("TEST 3 — portal_user_id pointing to missing user denies activation", async () => {
  const result = await resolveActivePortalAccount(
    { portalUserId: 99999 },
    { findUserById: async () => undefined },
  );
  assert.equal(result.ok, false);
});

test("TEST 4 — portal user with wrong role (physician) denies activation", async () => {
  const result = await resolveActivePortalAccount(
    { portalUserId: 7 },
    { findUserById: async () => fakeUser({ id: 7, role: "physician", isActive: true }) },
  );
  assert.equal(result.ok, false);
});

test("TEST 5 — inactive portal user denies activation", async () => {
  const result = await resolveActivePortalAccount(
    { portalUserId: 502 },
    { findUserById: async () => fakeUser({ id: 502, role: "patient", isActive: false }) },
  );
  assert.equal(result.ok, false);
});

test("TEST 11 — created_by_id is irrelevant; only portal_user_id is checked", async () => {
  // Even if a caller mistakenly thinks created_by_id=1 (super_admin) matters,
  // activation only looks at portalUserId.
  const result = await resolveActivePortalAccount(
    { portalUserId: null },
    {
      findUserById: async () =>
        fakeUser({ id: 1, role: "super_admin", username: "admin", isActive: true }),
    },
  );
  assert.equal(result.ok, false);
});

test("super_admin linked via portal_user_id is still denied (wrong role)", async () => {
  const result = await resolveActivePortalAccount(
    { portalUserId: 1 },
    {
      findUserById: async () =>
        fakeUser({ id: 1, role: "super_admin", username: "admin", isActive: true }),
    },
  );
  assert.equal(result.ok, false);
});

test("TEST 10 — portal JWT type is not accepted as staff access token", async () => {
  const { signPortalToken, verifyToken } = await import(
    "../../artifacts/api-server/src/lib/auth.js"
  );
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-activation-gate-tests-only-32chars";
  }
  const token = signPortalToken({ patientId: 1, patientHisId: "TEST-ACE-001" });
  const payload = verifyToken(token);
  assert.ok(payload);
  assert.equal(payload.type, "portal");
  assert.notEqual(payload.type, "access");
  assert.equal("role" in payload, false);
  assert.equal("userId" in payload, false);
});
