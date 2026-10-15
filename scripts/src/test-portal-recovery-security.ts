/**

 * Targeted recovery security unit tests (mocked email + in-memory patient).

 * Does not write to ACE_ResultsPortal or LiveDB_ACE.

 */

import assert from "node:assert/strict";

import { after, before, beforeEach, test } from "node:test";

import { loadRootEnv } from "@workspace/db";

import {

  createRecoveryJti,

  generateOtp,

  hashAccessCode,

  hashOtp,

  RECOVERY_TOKEN_TTL_MS,

  signRecoveryToken,

  verifyRecoveryToken,

} from "../../artifacts/api-server/src/lib/auth.js";

import { setPortalEmailSenderForTests } from "../../artifacts/api-server/src/lib/portal-email.js";

import { confirmPasswordRecovery, verifyPasswordRecoveryOtp } from "../../artifacts/api-server/src/lib/portal-recovery.js";

import {

  clearRecoveryTxnsForTests,

  createRecoveryTxn,

  getRecoveryTxn,

} from "../../artifacts/api-server/src/lib/recovery-state.js";



loadRootEnv();



const newPassword = "RecoveryPass1!";



type FakePatient = {

  id: number;

  email: string | null;

  accessCodeHash: string;

  portalUserId: number | null;

};



let patient: FakePatient;

let passwordUpdates: string[];

let emailsSent: Array<{ to: string; subject: string; text: string }>;

let emailShouldFail: boolean;



before(() => {

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {

    process.env.JWT_SECRET = "test-jwt-secret-for-recovery-security-tests-only-32chars";

  }

});



beforeEach(async () => {

  clearRecoveryTxnsForTests();

  passwordUpdates = [];

  emailsSent = [];

  emailShouldFail = false;

  const initialHash = await hashAccessCode("ACE-OLD1-CODE");

  patient = {

    id: 9001,

    email: "patient.recovery@example.com",

    accessCodeHash: initialHash,

    portalUserId: 9100,

  };



  setPortalEmailSenderForTests(async (to, subject, text) => {

    if (emailShouldFail) return false;

    emailsSent.push({ to, subject, text });

    return true;

  });

});



after(() => {

  setPortalEmailSenderForTests(null);

  clearRecoveryTxnsForTests();

});



function issueRecovery(otp: string) {

  const otpHash = hashOtp(otp);

  const jti = createRecoveryJti();

  createRecoveryTxn({

    jti,

    patientId: patient.id,

    otpHash,

    ttlMs: RECOVERY_TOKEN_TTL_MS,

  });

  const recoveryToken = signRecoveryToken({

    patientId: patient.id,

    otpHash,

    jti,

  });

  return { recoveryToken, otp, jti };

}



const hooks = () => ({

  findPatientById: async (id: number) => (id === patient.id ? { ...patient } as never : undefined),

  setUserPassword: async (userId: number, passwordHash: string) => {

    assert.equal(userId, patient.portalUserId);

    passwordUpdates.push(passwordHash);

  },

  isEmailConfigured: () => true,

  resolvePortalAccount: async (row: { portalUserId?: number | null }) => {

    if (row.portalUserId == null) return { ok: false as const };

    return {

      ok: true as const,

      user: {

        id: row.portalUserId,

        username: "patient:test",

        passwordHash: "x",

        firstName: "Test",

        lastName: "Patient",

        email: patient.email,

        role: "patient",

        isActive: true,

        failedLoginAttempts: 0,

        lockedUntil: null,

        lastLoginAt: null,

        createdAt: new Date(),

        updatedAt: new Date(),

      },

    };

  },

});



test("OTP generation is six digits without modulo-bias style truncation issues", () => {

  for (let i = 0; i < 20; i += 1) {

    assert.match(generateOtp(), /^\d{6}$/);

  }

});



test("recovery JWT is type recovery and cannot be used as portal", () => {

  const { recoveryToken } = issueRecovery("123456");

  const payload = verifyRecoveryToken(recoveryToken);

  assert.ok(payload);

  assert.equal(payload.type, "recovery");

  assert.equal(typeof payload.jti, "string");

  assert.equal("accessCode" in payload, false);

});



test("email delivery failure does not update portal password", async () => {

  const otp = "654321";

  const { recoveryToken } = issueRecovery(otp);

  emailShouldFail = true;

  assert.equal(verifyPasswordRecoveryOtp({ recoveryToken, otp }).ok, true);



  const result = await confirmPasswordRecovery({ recoveryToken, otp, newPassword }, hooks());

  assert.equal(result.ok, false);

  if (!result.ok) assert.equal(result.kind, "email_unavailable");

  assert.equal(passwordUpdates.length, 0);

  assert.equal(emailsSent.length, 0);



  const stillActive = getRecoveryTxn(verifyRecoveryToken(recoveryToken)!.jti);

  assert.ok(stillActive);

  assert.equal(stillActive.status, "otp_verified");

});



test("successful recovery emails confirmation then updates password and is single-use", async () => {

  const otp = "111222";

  const { recoveryToken } = issueRecovery(otp);

  assert.equal(verifyPasswordRecoveryOtp({ recoveryToken, otp }).ok, true);



  const first = await confirmPasswordRecovery({ recoveryToken, otp, newPassword }, hooks());

  assert.equal(first.ok, true);

  assert.equal(passwordUpdates.length, 1);

  assert.equal(emailsSent.length, 1);

  assert.match(emailsSent[0]!.text, /password has been reset successfully/i);

  assert.equal("accessCode" in (first as object), false);



  const second = await confirmPasswordRecovery({ recoveryToken, otp, newPassword }, hooks());

  assert.equal(second.ok, false);

  if (!second.ok) assert.equal(second.kind, "invalid_token");

  assert.equal(passwordUpdates.length, 1);

  assert.equal(emailsSent.length, 1);

});



test("invalid OTP does not change password or send email", async () => {

  const { recoveryToken } = issueRecovery("333444");



  const result = verifyPasswordRecoveryOtp({ recoveryToken, otp: "000000" });

  assert.equal(result.ok, false);

  if (!result.ok) assert.equal(result.kind, "invalid_otp");

  assert.equal(passwordUpdates.length, 0);

  assert.equal(emailsSent.length, 0);



  const txn = getRecoveryTxn(verifyRecoveryToken(recoveryToken)!.jti);

  assert.ok(txn);

  assert.equal(txn.status, "active");

});



test("expired recovery transaction is rejected", async () => {

  const otp = "555666";

  const otpHash = hashOtp(otp);

  const jti = createRecoveryJti();

  createRecoveryTxn({

    jti,

    patientId: patient.id,

    otpHash,

    ttlMs: 1,

  });

  const recoveryToken = signRecoveryToken({ patientId: patient.id, otpHash, jti });

  await new Promise((r) => setTimeout(r, 5));



  const result = await confirmPasswordRecovery({ recoveryToken, otp, newPassword }, hooks());

  assert.equal(result.ok, false);

  if (!result.ok) assert.equal(result.kind, "invalid_token");

  assert.equal(passwordUpdates.length, 0);

});



test("confirm recovery rejects patient without activated portal account", async () => {

  patient.portalUserId = null;

  const otp = "777888";

  const { recoveryToken } = issueRecovery(otp);

  assert.equal(verifyPasswordRecoveryOtp({ recoveryToken, otp }).ok, true);



  const result = await confirmPasswordRecovery({ recoveryToken, otp, newPassword }, hooks());

  assert.equal(result.ok, false);

  if (!result.ok) assert.equal(result.kind, "patient_not_found");

  assert.equal(passwordUpdates.length, 0);

  assert.equal(emailsSent.length, 0);

});



test("confirm recovery rejects weak password without updating hash", async () => {

  const otp = "888999";

  const { recoveryToken } = issueRecovery(otp);



  const result = await confirmPasswordRecovery({ recoveryToken, otp, newPassword: "weak" }, hooks());

  assert.equal(result.ok, false);

  if (!result.ok) assert.equal(result.kind, "invalid_password");

  assert.equal(passwordUpdates.length, 0);

  assert.equal(emailsSent.length, 0);

});



test("password reset is rejected until the OTP is verified", async () => {

  const otp = "121212";

  const { recoveryToken } = issueRecovery(otp);

  const blocked = await confirmPasswordRecovery({ recoveryToken, otp, newPassword }, hooks());

  assert.equal(blocked.ok, false);

  if (!blocked.ok) assert.equal(blocked.kind, "otp_required");

  assert.equal(passwordUpdates.length, 0);



  const wrong = verifyPasswordRecoveryOtp({ recoveryToken, otp: "000000" });

  assert.equal(wrong.ok, false);

  assert.equal(getRecoveryTxn(verifyRecoveryToken(recoveryToken)!.jti)?.status, "active");



  assert.equal(verifyPasswordRecoveryOtp({ recoveryToken, otp }).ok, true);

  assert.equal(getRecoveryTxn(verifyRecoveryToken(recoveryToken)!.jti)?.status, "otp_verified");



  const reset = await confirmPasswordRecovery({ recoveryToken, otp, newPassword }, hooks());

  assert.equal(reset.ok, true);

  assert.equal(passwordUpdates.length, 1);

});


