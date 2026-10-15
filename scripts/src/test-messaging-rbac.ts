import assert from "node:assert/strict";
import test from "node:test";
import {
  canAssociatePatientInMessage,
  canManageAnnouncements,
  canMessageRole,
} from "../../artifacts/api-server/src/lib/messaging-rbac";

test("staff can message physician and admin, not other staff", () => {
  assert.equal(canMessageRole("laboratory", "physician"), true);
  assert.equal(canMessageRole("laboratory", "super_admin"), true);
  assert.equal(canMessageRole("laboratory", "medical_records"), true);
  assert.equal(canMessageRole("laboratory", "radiology"), false);
  assert.equal(canMessageRole("laboratory", "patient"), false);
});

test("physician can message staff and admin, not other physicians", () => {
  assert.equal(canMessageRole("physician", "laboratory"), true);
  assert.equal(canMessageRole("physician", "super_admin"), true);
  assert.equal(canMessageRole("physician", "physician"), false);
});

test("physician can message patient at role level (assignment enforced in routes)", () => {
  assert.equal(canMessageRole("physician", "patient"), true);
});

test("admin can message staff and physicians", () => {
  assert.equal(canMessageRole("super_admin", "laboratory"), true);
  assert.equal(canMessageRole("super_admin", "physician"), true);
  assert.equal(canMessageRole("medical_records", "physician"), true);
});

test("admin can message patient at role level", () => {
  assert.equal(canMessageRole("super_admin", "patient"), true);
  assert.equal(canMessageRole("medical_records", "patient"), true);
});

test("only super_admin can manage announcements", () => {
  assert.equal(canManageAnnouncements("super_admin"), true);
  assert.equal(canManageAnnouncements("medical_records"), false);
  assert.equal(canManageAnnouncements("physician"), false);
  assert.equal(canManageAnnouncements("laboratory"), false);
});

test("patients cannot associate patient context; may message care team roles", () => {
  assert.equal(canAssociatePatientInMessage("patient"), false);
  assert.equal(canAssociatePatientInMessage("physician"), true);
  assert.equal(canMessageRole("patient", "physician"), true);
  assert.equal(canMessageRole("patient", "medical_records"), true);
  assert.equal(canMessageRole("patient", "laboratory"), false);
  assert.equal(canMessageRole("patient", "patient"), false);
});
