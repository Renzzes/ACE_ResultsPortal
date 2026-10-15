/**
 * Phase 2 — realtime delivery, auth gate, reload selection, dedupe.
 * Does not write to ACE_ResultsPortal or LiveDB_ACE.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { signAccessToken, signRegistrationToken } from "../../artifacts/api-server/src/lib/auth.js";
import { authenticateLiveSocket } from "../../artifacts/api-server/src/lib/message-live-auth.js";
import {
  deliverPersistedMessage,
  messageCreatedEvent,
  registerLiveClientForTests,
  resetLiveClientsForTests,
  senderLabel,
} from "../../artifacts/api-server/src/lib/message-live.js";
import { appendMessageById, applyThreadListUpdate, reconnectDelayMs } from "../../artifacts/ace-results-portal/src/lib/message-live-state.ts";
import { readThreadId } from "../../artifacts/ace-results-portal/src/lib/thread-selection.ts";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = "test-jwt-secret-for-message-live-phase2-32";
}

function sink() {
  const sent: string[] = [];
  return {
    readyState: 1,
    sent,
    send(data: string) {
      sent.push(data);
    },
    close() {
      this.readyState = 3;
    },
    once() {
      return undefined;
    },
  };
}

test("unauthenticated and non-access tokens are rejected", async () => {
  assert.equal(await authenticateLiveSocket(""), null);
  assert.equal(await authenticateLiveSocket("not-a-token"), null);
  const registration = signRegistrationToken({ patientHisId: "P-1" });
  assert.equal(await authenticateLiveSocket(registration), null);
  const patientOnStaff = signAccessToken({
    userId: 9,
    username: "patient:P",
    role: "patient",
  });
  assert.equal(await authenticateLiveSocket(patientOnStaff), null);
});

test("staff access token without sid binds that user id only", async () => {
  const token = signAccessToken({ userId: 42, username: "lab.user", role: "laboratory" });
  const identity = await authenticateLiveSocket(token);
  assert.deepEqual(identity, { userId: 42, audience: "staff" });
});

test("events go only to participant sockets", () => {
  resetLiveClientsForTests();
  const staff = sink();
  const doctor = sink();
  const stranger = sink();
  registerLiveClientForTests({ userId: 11, audience: "staff", socket: staff });
  registerLiveClientForTests({ userId: 21, audience: "staff", socket: doctor });
  registerLiveClientForTests({ userId: 99, audience: "portal", socket: stranger });

  deliverPersistedMessage({
    conversationId: 7,
    sender: { id: 11, firstName: "Juan", lastName: "Cruz", role: "laboratory" },
    messageId: 456,
    body: "Hello",
    createdAt: "2026-10-08T00:00:00.000Z",
    recipientUserIds: [11, 21],
  });

  assert.equal(staff.sent.length, 1);
  assert.equal(doctor.sent.length, 1);
  assert.equal(stranger.sent.length, 0);
  const staffEvent = JSON.parse(staff.sent[0]!) as { message: { mine: boolean; id: number } };
  const doctorEvent = JSON.parse(doctor.sent[0]!) as { message: { mine: boolean; senderName: string } };
  assert.equal(staffEvent.message.mine, true);
  assert.equal(staffEvent.message.id, 456);
  assert.equal(doctorEvent.message.mine, false);
  assert.equal(doctorEvent.message.senderName, "Cruz, Juan");
  assert.equal(JSON.stringify(staffEvent).includes("password"), false);
  assert.equal(JSON.stringify(staffEvent).includes("token"), false);
  resetLiveClientsForTests();
});

test("portal audience gets the public sender label", () => {
  assert.equal(
    senderLabel({ firstName: "Maria", lastName: "Santos", role: "super_admin" }, "portal"),
    "Patient Support",
  );
  assert.equal(
    senderLabel({ firstName: "Maria", lastName: "Santos", role: "super_admin" }, "staff"),
    "Santos, Maria",
  );
});

test("message event contract does not carry secrets", () => {
  const event = messageCreatedEvent({
    conversationId: 3,
    senderUserId: 4,
    senderName: "Cruz, Juan",
    mine: false,
    body: "Hello",
    createdAt: "2026-10-08T00:00:00.000Z",
    messageId: 8,
  });
  assert.equal(event.type, "message.created");
  assert.equal("passwordHash" in event.message, false);
  assert.equal("patientHisId" in event, false);
});

test("reload reads threadId and ignores a missing or invalid id", () => {
  assert.equal(readThreadId("?threadId=15"), 15);
  assert.equal(readThreadId("threadId=15"), 15);
  assert.equal(readThreadId(""), null);
  assert.equal(readThreadId("?threadId=0"), null);
  assert.equal(readThreadId("?threadId=abc"), null);
});

test("duplicate message ids are not appended and unread follows the open thread", () => {
  const first = appendMessageById([{ id: 1 }], { id: 2, body: "Hi" });
  assert.equal(first.length, 2);
  assert.equal(appendMessageById(first, { id: 2, body: "Hi" }).length, 2);

  const list = [
    { id: 10, unreadCount: 0, lastMessagePreview: null, lastMessageAt: null, updatedAt: "2026-10-01T00:00:00.000Z" },
    { id: 11, unreadCount: 1, lastMessagePreview: "old", lastMessageAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" },
  ];
  const event = {
    type: "message.created" as const,
    conversationId: 11,
    message: {
      id: 90,
      senderUserId: 2,
      senderName: "Cruz, Juan",
      mine: false,
      body: "Hello",
      createdAt: "2026-10-08T01:00:00.000Z",
    },
  };
  const closed = applyThreadListUpdate(list, event, 10);
  assert.equal(closed.threads[0]?.id, 11);
  assert.equal(closed.threads[0]?.unreadCount, 2);
  const open = applyThreadListUpdate(list, event, 11);
  assert.equal(open.threads[0]?.unreadCount, 0);
});

test("reconnect delay backs off and stays capped", () => {
  assert.equal(reconnectDelayMs(0), 1_000);
  assert.equal(reconnectDelayMs(1), 2_000);
  assert.equal(reconnectDelayMs(2), 4_000);
  assert.equal(reconnectDelayMs(3), 8_000);
  assert.equal(reconnectDelayMs(8), 30_000);
});
