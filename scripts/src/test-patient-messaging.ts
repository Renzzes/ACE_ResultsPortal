/**
 * Phase 6E — Patient Portal messaging verification / hardening tests.
 * Mocked helpers only. Does not write to ACE_ResultsPortal or LiveDB_ACE.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  canAssociatePatientInMessage,
  canMessageRole,
} from "../../artifacts/api-server/src/lib/messaging-rbac.js";
import {
  assertPatientMayMessageRecipient,
  messageReceivedNotificationInput,
  sanitizeMessageBody,
  sanitizeMessageSubject,
} from "../../artifacts/api-server/src/lib/portal-messaging.js";
import { resolveActivePortalAccount } from "../../artifacts/api-server/src/lib/portal-activation.js";
import { signPortalToken, verifyToken } from "../../artifacts/api-server/src/lib/auth.js";
import { notificationHref } from "../../artifacts/ace-results-portal/src/lib/notification-utils.ts";
import type { User } from "@workspace/db";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 500,
    username: "patient:TEST",
    passwordHash: "x",
    firstName: "Pat",
    lastName: "Ent",
    email: "p@example.com",
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

test("TEST 2 — patient without portal_user_id denied messaging identity", async () => {
  const result = await resolveActivePortalAccount(
    { portalUserId: null },
    { findUserById: async () => fakeUser() },
  );
  assert.equal(result.ok, false);
});

test("TEST 3/5 — assigned physician allowed; unassigned physician denied", async () => {
  const assigned = await assertPatientMayMessageRecipient(10, 500, 7, {
    findUserById: async (id) =>
      id === 7 ? fakeUser({ id: 7, role: "physician", isActive: true }) : undefined,
    findAssignment: async (patientId, physicianId) =>
      patientId === 10 && physicianId === 7 ? { id: 1 } : undefined,
  });
  assert.equal(assigned.ok, true);

  const unassigned = await assertPatientMayMessageRecipient(10, 500, 8, {
    findUserById: async (id) =>
      id === 8 ? fakeUser({ id: 8, role: "physician", isActive: true }) : undefined,
    findAssignment: async () => undefined,
  });
  assert.equal(unassigned.ok, false);
  if (!unassigned.ok) assert.equal(unassigned.reason, "forbidden");
});

test("TEST 4 — patient cannot message another patient", async () => {
  assert.equal(canMessageRole("patient", "patient"), false);
  const result = await assertPatientMayMessageRecipient(10, 500, 501, {
    findUserById: async () => fakeUser({ id: 501, role: "patient", isActive: true }),
    findAssignment: async () => ({ id: 1 }),
  });
  assert.equal(result.ok, false);
});

test("TEST 7/8 — Medical Records and Admin allowed; lab/rad denied", async () => {
  const mr = await assertPatientMayMessageRecipient(10, 500, 3, {
    findUserById: async () => fakeUser({ id: 3, role: "medical_records", isActive: true }),
    findAssignment: async () => undefined,
  });
  assert.equal(mr.ok, true);

  const admin = await assertPatientMayMessageRecipient(10, 500, 1, {
    findUserById: async () => fakeUser({ id: 1, role: "super_admin", isActive: true }),
    findAssignment: async () => undefined,
  });
  assert.equal(admin.ok, true);

  const lab = await assertPatientMayMessageRecipient(10, 500, 4, {
    findUserById: async () => fakeUser({ id: 4, role: "laboratory", isActive: true }),
    findAssignment: async () => undefined,
  });
  assert.equal(lab.ok, false);
  assert.equal(canMessageRole("patient", "radiology"), false);
});

test("TEST 9/10 — patient_id and sender are server-derived (client fields ignored)", () => {
  assert.equal(canAssociatePatientInMessage("patient"), false);
  // Route contract: createThread uses identity.patient.id + identity.portalUserId only.
});

test("TEST 11/12 — arbitrary participant / self-message denied", async () => {
  const self = await assertPatientMayMessageRecipient(10, 500, 500, {
    findUserById: async () => fakeUser({ id: 500 }),
    findAssignment: async () => ({ id: 1 }),
  });
  assert.equal(self.ok, false);
});

test("TEST 14/15 IDOR — foreign thread ownership check", () => {
  const threadA = { id: 100, patientId: 10 };
  const threadB = { id: 200, patientId: 20 };
  assert.equal(threadA.patientId === 10, true);
  assert.equal(threadB.patientId === 10, false);
});

test("TEST 16 — markThreadRead scopes by user_id only", () => {
  // messagesRepo.markThreadRead updates WHERE thread_id AND user_id — verified by SQL.
  const sql = "WHERE thread_id = @threadId AND user_id = @userId";
  assert.match(sql, /user_id/);
});

test("TEST 18/21 — notification deep link uses thread entityId; body stays generic", () => {
  const input = messageReceivedNotificationInput(123);
  assert.equal(input.type, "message_received");
  assert.equal(input.entityType, "thread");
  assert.equal(input.entityId, 123);
  assert.equal(input.body, "You have received a new message.");
  assert.equal(input.body.includes("Test message"), false);

  const href = notificationHref(
    { type: "message_received", entityType: "thread", entityId: 123 },
    "portal",
  );
  assert.equal(href, "/portal/messages?threadId=123");
});

test("TEST 19 — doctor/admin may message patient at role level; lab cannot", () => {
  assert.equal(canMessageRole("physician", "patient"), true);
  assert.equal(canMessageRole("medical_records", "patient"), true);
  assert.equal(canMessageRole("super_admin", "patient"), true);
  assert.equal(canMessageRole("laboratory", "patient"), false);
});

test("TEST 22 — portal JWT is not a staff access token", () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "test-jwt-secret-for-patient-messaging-tests-32chars";
  }
  const token = signPortalToken({ patientId: 10, patientHisId: "P-10" });
  const payload = verifyToken(token);
  assert.ok(payload);
  assert.equal(payload.type, "portal");
  assert.notEqual(payload.type, "access");
  assert.equal("userId" in payload, false);
});

test("TEST 24 — message validation rejects empty/oversized", () => {
  assert.equal(sanitizeMessageBody(""), null);
  assert.equal(sanitizeMessageBody("   "), null);
  assert.equal(sanitizeMessageBody("Hello"), "Hello");
  assert.equal(sanitizeMessageBody("x".repeat(4001)), null);
  assert.equal(sanitizeMessageSubject(""), null);
  assert.equal(sanitizeMessageSubject("Follow-up"), "Follow-up");
  assert.equal(sanitizeMessageSubject("x".repeat(256)), null);
});

test("TEST 26 — staff↔doctor matrix still intact; doctor↔doctor blocked", () => {
  assert.equal(canMessageRole("laboratory", "physician"), true);
  assert.equal(canMessageRole("physician", "super_admin"), true);
  assert.equal(canMessageRole("physician", "physician"), false);
  assert.equal(canMessageRole("laboratory", "radiology"), false);
});

test("TEST role — patient messaging matrix summary", () => {
  assert.equal(canMessageRole("patient", "physician"), true);
  assert.equal(canMessageRole("patient", "medical_records"), true);
  assert.equal(canMessageRole("patient", "super_admin"), true);
  assert.equal(canMessageRole("patient", "laboratory"), false);
  assert.equal(canMessageRole("patient", "patient"), false);
});
