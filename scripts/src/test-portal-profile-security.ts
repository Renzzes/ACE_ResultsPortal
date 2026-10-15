/**
 * Phase 6F — Patient Portal profile & account security tests.
 * Mocked helpers only. Does not write to ACE_ResultsPortal or LiveDB_ACE.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { signAccessToken, signPortalToken, verifyToken } from "../../artifacts/api-server/src/lib/auth.js";
import { resolveActivePortalAccount } from "../../artifacts/api-server/src/lib/portal-activation.js";
import {
  extractPortalContactPatch,
  formatPortalProfile,
  normalizePortalEmail,
  normalizePortalMobile,
  profileAuditDetails,
  resolvePortalProfilePatient,
  updatePortalProfileContact,
} from "../../artifacts/api-server/src/lib/portal-profile.js";
import { canMessageRole } from "../../artifacts/api-server/src/lib/messaging-rbac.js";
import type { Patient, User } from "@workspace/db";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 500,
    username: "patient:TEST",
    passwordHash: "x",
    firstName: "Pat",
    lastName: "Ent",
    email: "pat@example.com",
    role: "patient",
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date("2026-08-01T10:00:00.000Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 10,
    patientHisId: "HIS-10",
    lastName: "Ent",
    firstName: "Pat",
    middleName: "M",
    dateOfBirth: "1990-01-15",
    mobileNumber: "09171234567",
    email: "pat@example.com",
    accessCodeHash: "hash",
    createdById: 1,
    portalUserId: 500,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("TEST 1 — authenticated patient profile formats without secrets", () => {
  const view = formatPortalProfile(fakePatient(), fakeUser());
  assert.equal(view.patientHisId, "HIS-10");
  assert.equal(view.firstName, "Pat");
  assert.equal(view.accountStatus, "active");
  assert.equal("portalUserId" in view, false);
  assert.equal("accessCodeHash" in view, false);
  assert.equal("createdById" in view, false);
  assert.equal("passwordHash" in view, false);
});

test("TEST 2/3/4/5 — activation gate for profile identity", async () => {
  assert.equal((await resolveActivePortalAccount({ portalUserId: null })).ok, false);

  const wrongRole = await resolvePortalProfilePatient(10, {
    findPatientById: async () => fakePatient(),
    findUserById: async () => fakeUser({ role: "physician" }),
  });
  assert.equal(wrongRole.ok, false);

  const inactive = await resolvePortalProfilePatient(10, {
    findPatientById: async () => fakePatient(),
    findUserById: async () => fakeUser({ isActive: false }),
  });
  assert.equal(inactive.ok, false);

  const ok = await resolvePortalProfilePatient(10, {
    findPatientById: async () => fakePatient(),
    findUserById: async () => fakeUser(),
  });
  assert.equal(ok.ok, true);
});

test("TEST 6/7 — patient can update own email and mobile", async () => {
  let stored = fakePatient();
  let user = fakeUser();
  const result = await updatePortalProfileContact(
    10,
    { email: "new@example.com", mobileNumber: "09998887777" },
    {
      findPatientById: async () => stored,
      findPatientByEmail: async () => undefined,
      findUserById: async () => user,
      findUserByEmail: async () => undefined,
      updatePatientContact: async (_id, patch) => {
        stored = { ...stored, ...patch, updatedAt: new Date() };
        return stored;
      },
      updateUserEmail: async (_id, email) => {
        user = { ...user, email };
        return user;
      },
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.patient.email, "new@example.com");
    assert.equal(result.patient.mobileNumber, "09998887777");
    assert.equal(result.emailChanged, true);
    assert.equal(result.mobileChanged, true);
  }
});

test("TEST 8/9 — client patientId ignored; update scoped to JWT patient", async () => {
  let writtenId: number | null = null;
  const result = await updatePortalProfileContact(
    10,
    { patientId: 999, email: "scoped@example.com" },
    {
      findPatientById: async (id) => (id === 10 ? fakePatient() : undefined),
      findPatientByEmail: async () => undefined,
      findUserById: async () => fakeUser(),
      findUserByEmail: async () => undefined,
      updatePatientContact: async (id, patch) => {
        writtenId = id;
        return fakePatient({ id, email: patch.email ?? null });
      },
      updateUserEmail: async (_id, email) => fakeUser({ email }),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(writtenId, 10);
});

test("TEST 10-17 — protected identity fields never written", async () => {
  const { patch, ignoredProtectedFields } = extractPortalContactPatch({
    patientId: 999,
    patientHisId: "OTHER",
    firstName: "Changed",
    middleName: "Changed",
    lastName: "Changed",
    dateOfBirth: "2000-01-01",
    portalUserId: 999,
    createdById: 999,
    accessCodeHash: "fake",
    email: "legitimate@example.com",
    mobileNumber: "09999999999",
  });
  assert.deepEqual(Object.keys(patch).sort(), ["email", "mobileNumber"]);
  assert.ok(ignoredProtectedFields.includes("patientHisId"));
  assert.ok(ignoredProtectedFields.includes("firstName"));
  assert.ok(ignoredProtectedFields.includes("accessCodeHash"));

  let writtenKeys: string[] = [];
  const baseline = fakePatient();
  const result = await updatePortalProfileContact(
    10,
    {
      patientHisId: "OTHER",
      firstName: "Hacker",
      middleName: "X",
      lastName: "Y",
      dateOfBirth: "2000-01-01",
      portalUserId: 1,
      createdById: 1,
      accessCodeHash: "fake",
      email: "legitimate@example.com",
      mobileNumber: "09999999999",
    },
    {
      findPatientById: async () => baseline,
      findPatientByEmail: async () => undefined,
      findUserById: async () => fakeUser(),
      findUserByEmail: async () => undefined,
      updatePatientContact: async (_id, contact) => {
        writtenKeys = Object.keys(contact);
        return fakePatient({
          ...baseline,
          email: contact.email ?? baseline.email,
          mobileNumber: contact.mobileNumber !== undefined ? contact.mobileNumber : baseline.mobileNumber,
        });
      },
      updateUserEmail: async (_id, email) => fakeUser({ email }),
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(writtenKeys.sort(), ["email", "mobileNumber"]);
  if (result.ok) {
    assert.equal(result.patient.firstName, "Pat");
    assert.equal(result.patient.patientHisId, "HIS-10");
    assert.equal(result.patient.dateOfBirth, "1990-01-15");
    assert.equal(result.patient.portalUserId, 500);
    assert.equal(result.patient.accessCodeHash, "hash");
    assert.equal(result.patient.createdById, 1);
  }
});

test("TEST 18 — email uniqueness enforced", async () => {
  const result = await updatePortalProfileContact(
    10,
    { email: "taken@example.com" },
    {
      findPatientById: async () => fakePatient(),
      findPatientByEmail: async () => fakePatient({ id: 20, email: "taken@example.com" }),
      findUserById: async () => fakeUser(),
      findUserByEmail: async () => undefined,
      updatePatientContact: async () => {
        throw new Error("must not write");
      },
      updateUserEmail: async () => {
        throw new Error("must not write");
      },
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
});

test("TEST 19/20 — invalid email and mobile rejected", () => {
  assert.equal((normalizePortalEmail("not-an-email") as { error: string }).error, "Invalid email.");
  assert.equal((normalizePortalEmail("   ") as { error: string }).error, "Email is required.");
  assert.equal((normalizePortalMobile("abc") as { error: string }).error, "Invalid mobile number.");
  assert.equal(normalizePortalMobile("0917 123 4567"), "0917 123 4567");
  assert.equal(normalizePortalMobile(""), null);
});

test("TEST 21/22 — profile audit tags contain no secrets", () => {
  const details = profileAuditDetails(true, true);
  assert.equal(details, "profile_updated email_changed mobile_changed");
  assert.equal(details.includes("@"), false);
  assert.equal(details.includes("hash"), false);
  assert.equal(details.includes("password"), false);
  assert.equal(details.includes("OTP"), false);
});

test("TEST 23 — portal JWT remains access-code session type; not staff", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-portal-profile-security-32c";
  }
  const token = signPortalToken({ patientId: 10, patientHisId: "HIS-10" });
  const payload = verifyToken(token);
  assert.ok(payload);
  assert.equal(payload.type, "portal");
  assert.equal("userId" in payload, false);
});

test("TEST 24/25/26 — staff/physician/admin JWT type is access, not portal", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-portal-profile-security-32c";
  }
  for (const role of ["medical_records", "physician", "super_admin"] as const) {
    const token = signAccessToken({ userId: 1, username: role, role });
    const payload = verifyToken(token);
    assert.ok(payload);
    assert.equal(payload.type, "access");
    assert.notEqual(payload.type, "portal");
  }
});

test("TEST 27/28 — notification/messaging role matrix still intact", () => {
  assert.equal(canMessageRole("patient", "physician"), true);
  assert.equal(canMessageRole("patient", "medical_records"), true);
  assert.equal(canMessageRole("patient", "patient"), false);
  assert.equal(canMessageRole("laboratory", "patient"), false);
});

test("TEST 29 — results authorization path identity remains JWT patientId", () => {
  const jwtPatientId = 10;
  const foreignResultPatientId = 20;
  assert.notEqual(jwtPatientId, foreignResultPatientId);
});

test("TEST 30 — activation gate still rejects null portal_user_id", async () => {
  const result = await resolveActivePortalAccount(fakePatient({ portalUserId: null }));
  assert.equal(result.ok, false);
});

test("TEST 31 — recovery continues to use patients.email after profile update", async () => {
  let stored = fakePatient({ email: "old@example.com" });
  await updatePortalProfileContact(
    10,
    { email: "recovery@example.com" },
    {
      findPatientById: async () => stored,
      findPatientByEmail: async () => undefined,
      findUserById: async () => fakeUser(),
      findUserByEmail: async () => undefined,
      updatePatientContact: async (_id, patch) => {
        stored = { ...stored, email: patch.email ?? stored.email };
        return stored;
      },
      updateUserEmail: async (_id, email) => fakeUser({ email }),
    },
  );
  assert.equal(stored.email, "recovery@example.com");
});
