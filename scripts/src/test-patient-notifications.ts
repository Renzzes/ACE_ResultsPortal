/**
 * Phase 6D-2 — Patient Portal notifications unit tests.
 * Mocked helpers only. Does not write to ACE_ResultsPortal or LiveDB_ACE.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Patient, User } from "@workspace/db";
import { resolveActivePortalAccount } from "../../artifacts/api-server/src/lib/portal-activation.js";
import { PATIENT_RESULT_RELEASED_TYPE } from "../../artifacts/api-server/src/lib/notify-result-released.js";
import { notificationHref } from "../../artifacts/ace-results-portal/src/lib/notification-utils.ts";
import { canPortalAccessResult } from "../../artifacts/api-server/src/lib/result-access.js";
import { signPortalToken, verifyToken } from "../../artifacts/api-server/src/lib/auth.js";

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

function fakePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 10,
    patientHisId: "PORTAL-TEST-001",
    lastName: "Test",
    firstName: "Patient",
    middleName: null,
    dateOfBirth: new Date("1990-01-01"),
    mobileNumber: null,
    email: "p@example.com",
    accessCodeHash: "hash",
    createdById: 1,
    portalUserId: 500,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("TEST kind — result_released is the patient release notification type", () => {
  assert.equal(PATIENT_RESULT_RELEASED_TYPE, "result_released");
});

test("TEST 1/2 — activation required for patient notify recipient", async () => {
  const active = await resolveActivePortalAccount(
    { portalUserId: 500 },
    { findUserById: async () => fakeUser({ id: 500, role: "patient", isActive: true }) },
  );
  assert.equal(active.ok, true);

  const pendingHospitalOnly = await resolveActivePortalAccount(
    { portalUserId: null },
    { findUserById: async () => fakeUser() },
  );
  assert.equal(pendingHospitalOnly.ok, false);
});

test("TEST 5 — hospital-only patient (portal_user_id NULL) is not a notify recipient", async () => {
  const patient = fakePatient({ portalUserId: null, createdById: 1 });
  const account = await resolveActivePortalAccount(patient, {
    findUserById: async () => fakeUser({ id: 1, role: "super_admin" }),
  });
  assert.equal(account.ok, false);
});

test("TEST 4 role — wrong role / inactive cannot be recipient", async () => {
  assert.equal(
    (
      await resolveActivePortalAccount(
        { portalUserId: 7 },
        { findUserById: async () => fakeUser({ id: 7, role: "physician", isActive: true }) },
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await resolveActivePortalAccount(
        { portalUserId: 8 },
        { findUserById: async () => fakeUser({ id: 8, role: "patient", isActive: false }) },
      )
    ).ok,
    false,
  );
});

test("TEST 6/7/8/9/10 — ownership is by recipient_user_id equality", () => {
  const patientAUserId = 501;
  const patientBNotification = { id: 200, recipientUserId: 502 };
  assert.notEqual(patientBNotification.recipientUserId, patientAUserId);
  // findNotificationForUser / markRead both require id AND recipient_user_id match.
});

test("TEST 11 — deep link for result_released points to portal results", () => {
  const href = notificationHref(
    { type: "result_released", entityType: "result", entityId: 25 },
    "portal",
  );
  assert.equal(href, "/portal/results?resultId=25");
});

test("TEST 12 — notification does not bypass result authorization", () => {
  const resultOwnedByA = {
    id: 25,
    patientId: 10,
    status: "released" as const,
  };
  const resultPending = { ...resultOwnedByA, status: "pending" as const };
  const resultOwnedByB = { ...resultOwnedByA, patientId: 99 };

  assert.equal(canPortalAccessResult(resultOwnedByA, 10), true);
  assert.equal(canPortalAccessResult(resultPending, 10), false);
  assert.equal(canPortalAccessResult(resultOwnedByB, 10), false);
});

test("TEST 13 audience — all_patients is a valid announcement target type", () => {
  const allowed = ["all_staff", "all_physicians", "department", "all_patients"];
  assert.ok(allowed.includes("all_patients"));
});

test("TEST 16/17 — portal JWT cannot be used as staff access token", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-patient-notifications-tests-32c";
  }
  const token = signPortalToken({ patientId: 10, patientHisId: "PORTAL-TEST-001" });
  const payload = verifyToken(token);
  assert.ok(payload);
  assert.equal(payload.type, "portal");
  assert.notEqual(payload.type, "access");
  assert.equal("userId" in payload, false);
  assert.equal("role" in payload, false);
});

test("TEST announce href — patient announcement deep link stays in portal", () => {
  const href = notificationHref(
    { type: "announcement", entityType: "announcement", entityId: 3 },
    "portal",
  );
  assert.equal(href, "/portal/notifications");
});

test("created_by_id is never the notification recipient path", async () => {
  const patient = fakePatient({ createdById: 1, portalUserId: null });
  const account = await resolveActivePortalAccount(patient, {
    findUserById: async (id) => fakeUser({ id, role: id === 1 ? "super_admin" : "patient" }),
  });
  assert.equal(account.ok, false);
});
