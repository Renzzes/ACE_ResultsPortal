/**
 * Phase 1 — recipient search and 1-to-1 conversation reuse.
 * Does not write to ACE_ResultsPortal or LiveDB_ACE.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { messagesRepo } from "@workspace/db";
import {
  canMessageRole,
  filterAuthorizedMessagingUsers,
  messagingDepartmentLabel,
} from "../../artifacts/api-server/src/lib/messaging-rbac.js";
import {
  filterPortalRecipientsBySearch,
  optionalMessageBody,
  optionalMessageSubject,
  portalRecipientSubtitle,
} from "../../artifacts/api-server/src/lib/portal-messaging.js";

const root = new URL("../../", import.meta.url);

function readRepo(relativePath: string) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

const staffUser = {
  id: 11,
  role: "laboratory",
  isActive: true,
  name: "Cruz, Juan",
};
const otherStaff = {
  id: 12,
  role: "radiology",
  isActive: true,
  name: "Reyes, Ana",
};
const physician = {
  id: 21,
  role: "physician",
  isActive: true,
  name: "Dela Cruz, Juan",
};
const admin = {
  id: 1,
  role: "super_admin",
  isActive: true,
  name: "Santos, Maria",
};
const patient = {
  id: 500,
  role: "patient",
  isActive: true,
  name: "Patient, Pat",
};

test("search returns authorized recipients and drops the caller", () => {
  const hits = filterAuthorizedMessagingUsers(
    { userId: staffUser.id, role: staffUser.role },
    [staffUser, physician, admin, otherStaff, patient],
  );
  assert.deepEqual(
    hits.map((user) => user.id),
    [physician.id, admin.id],
  );
});

test("search for a nonexistent person matches nothing in the authorized set", () => {
  const allowed = [{ id: 21, name: "Dr. Dela Cruz, Juan", role: "physician" }];
  assert.deepEqual(filterPortalRecipientsBySearch(allowed, "Nobody"), []);
});

test("unauthorized staff peer is not searchable", () => {
  assert.equal(canMessageRole("laboratory", "radiology"), false);
  const hits = filterAuthorizedMessagingUsers(
    { userId: staffUser.id, role: "laboratory" },
    [otherStaff],
  );
  assert.equal(hits.length, 0);
});

test("selecting the same pair reuses one lock resource and one open thread", () => {
  assert.equal(messagesRepo.directPairLockResource(11, 21), messagesRepo.directPairLockResource(21, 11));
  assert.notEqual(messagesRepo.directPairLockResource(11, 21), messagesRepo.directPairLockResource(11, 22));
  const lookup = messagesRepo.findOpenDirectThread.toString();
  assert.match(lookup, /is_closed = 0/);
  assert.match(lookup, /= 2/);
  const openOrCreate = readRepo("artifacts/api-server/src/lib/direct-thread.ts");
  assert.match(openOrCreate, /findOpenDirectThread/);
  assert.match(openOrCreate, /acquireDirectPairLock/);
  assert.match(openOrCreate, /reused: true/);
  assert.match(openOrCreate, /reused: false/);
});

test("current user cannot select themselves", () => {
  const hits = filterAuthorizedMessagingUsers(
    { userId: physician.id, role: "physician" },
    [physician, staffUser],
  );
  assert.equal(
    hits.some((user) => user.id === physician.id),
    false,
  );
  assert.equal(canMessageRole("physician", "physician"), false);
});

test("staff thread access denial stays 403 and portal foreign threads stay 404", () => {
  const staffRoutes = readRepo("artifacts/api-server/src/routes/messages.ts");
  const portalRoutes = readRepo("artifacts/api-server/src/routes/portal-messages.ts");
  assert.match(staffRoutes, /Unauthorized attempt to access message thread/);
  assert.match(staffRoutes, /requireAuth/);
  assert.match(portalRoutes, /res\.status\(404\)\.json\(\{ error: "Thread not found" \}\)/);
  assert.match(portalRoutes, /requirePortalAuth/);
  assert.doesNotMatch(staffRoutes, /localStorage/);
  assert.doesNotMatch(portalRoutes, /localStorage/);
  assert.doesNotMatch(staffRoutes, /\/auth\/login/);
  assert.doesNotMatch(portalRoutes, /\/auth\/login/);
});

test("message load, send, and read routes are unchanged entry points", () => {
  const staffRoutes = readRepo("artifacts/api-server/src/routes/messages.ts");
  assert.match(staffRoutes, /router\.get\("\/messages\/threads\/:id"/);
  assert.match(staffRoutes, /router\.post\("\/messages\/threads\/:id\/messages"/);
  assert.match(staffRoutes, /router\.post\("\/messages\/threads\/:id\/read"/);
  assert.match(staffRoutes, /markThreadRead/);
  const workspace = readRepo("artifacts/ace-results-portal/src/components/comms/messages-workspace.tsx");
  assert.match(workspace, /sendMessage\(activeId!/);
  assert.match(workspace, /fetchMessageThread/);
  assert.match(workspace, /unreadCount/);
  assert.doesNotMatch(workspace, /socket\.io|WebSocket|EventSource/i);
});

test("admin, staff, and doctor share the messages workspace; patient uses portal routes", () => {
  assert.match(readRepo("artifacts/ace-results-portal/src/pages/admin/messages.tsx"), /MessagesWorkspace/);
  assert.match(readRepo("artifacts/ace-results-portal/src/pages/staff/messages.tsx"), /MessagesWorkspace/);
  assert.match(readRepo("artifacts/ace-results-portal/src/pages/physician/messages.tsx"), /MessagesWorkspace/);
  const patientPage = readRepo("artifacts/ace-results-portal/src/pages/portal/messages.tsx");
  assert.match(patientPage, /createPortalMessageThread\(\{ recipientUserId \}\)/);
  assert.doesNotMatch(patientPage, /fetchMessageRecipients/);
  assert.match(patientPage, /Search people/);
});

test("patient search stays inside assigned doctors, medical records, and support", () => {
  const allowed = [
    { id: 21, name: "Dr. Dela Cruz, Juan", role: "physician" },
    { id: 3, name: "ACE Medical Records", role: "medical_records" },
    { id: 1, name: "Patient Support", role: "super_admin" },
  ];
  assert.equal(filterPortalRecipientsBySearch(allowed, "J").length, 0);
  assert.equal(filterPortalRecipientsBySearch(allowed, "Juan").length, 1);
  assert.equal(filterPortalRecipientsBySearch(allowed, "laboratory").length, 0);
  assert.equal(filterPortalRecipientsBySearch(allowed, "super_admin").length, 0);
  assert.equal(portalRecipientSubtitle("physician"), "Assigned physician");
  assert.equal(canMessageRole("patient", "laboratory"), false);
  assert.equal(canMessageRole("patient", "patient"), false);
});

test("opening a conversation does not require a message body", () => {
  assert.deepEqual(optionalMessageBody(undefined), { ok: true, value: null });
  assert.deepEqual(optionalMessageBody(""), { ok: true, value: null });
  assert.deepEqual(optionalMessageBody("Hello"), { ok: true, value: "Hello" });
  assert.deepEqual(optionalMessageSubject(undefined), { ok: true, value: null });
  assert.equal(optionalMessageBody("x".repeat(4001)).ok, false);
});

test("department label uses department name and never a secret", () => {
  assert.equal(messagingDepartmentLabel("laboratory", "Laboratory"), "Laboratory");
  assert.equal(messagingDepartmentLabel("physician", null), "Physician");
  assert.equal(messagingDepartmentLabel("patient", null), "Patient");
});

test("new conversation UI searches people instead of composing a subject", () => {
  const workspace = readRepo("artifacts/ace-results-portal/src/components/comms/messages-workspace.tsx");
  assert.match(workspace, /Search people\.\.\./);
  assert.doesNotMatch(workspace, /placeholder="Subject"/);
  assert.doesNotMatch(workspace, /placeholder="Message"/);
  assert.match(workspace, /createMessageThread\(\{ recipientUserId \}\)/);
});
