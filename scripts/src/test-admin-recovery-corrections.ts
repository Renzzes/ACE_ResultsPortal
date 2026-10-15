/**
 * Admin result opening, patient date of birth, and recovery step progression.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);

function readRepo(relativePath: string) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

function formatDateOfBirth(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return "Not recorded";
  return `${match[2]}/${match[3]}/${match[1]}`;
}

test("admin results open the protected file and do not link to staff upload", () => {
  const admin = readRepo("artifacts/ace-results-portal/src/pages/admin/results.tsx");
  const overview = readRepo("artifacts/ace-results-portal/src/pages/admin/overview.tsx");
  const staff = readRepo("artifacts/ace-results-portal/src/pages/results/index.tsx");
  const uploadPage = readRepo("artifacts/ace-results-portal/src/pages/results/upload.tsx");
  const router = readRepo("artifacts/ace-results-portal/src/App.tsx");
  const download = readRepo("artifacts/api-server/src/routes/results.ts");
  assert.doesNotMatch(admin, /Upload result/i);
  assert.doesNotMatch(admin, /href="\/results/);
  assert.doesNotMatch(overview, /Upload Result/);
  assert.doesNotMatch(overview, /\/results\/upload/);
  assert.match(admin, /getResultDownloadUrl/);
  assert.match(admin, /inline=1/);
  assert.match(admin, /type="button"/);
  assert.doesNotMatch(admin, /setLocation\("\/results"\)/);
  assert.match(staff, /Upload Result/);
  assert.match(staff, /\/results\/upload/);
  assert.match(uploadPage, /\/api\/results\/upload/);
  assert.match(router, /path="\/results\/upload"/);
  assert.match(download, /router\.post\("\/results\/upload", requireAuth/);
  assert.match(download, /router\.get\("\/results\/:id\/download", requireAuth/);
  assert.match(download, /router\.get\("\/results\/file\/:token"/);
  assert.doesNotMatch(download, /\/api\/public\/results/);
});

test("admin patient account shows the stored date of birth", () => {
  const page = readRepo("artifacts/ace-results-portal/src/pages/admin/patients.tsx");
  const formatter = readRepo("artifacts/api-server/src/lib/formatters.ts");
  assert.match(page, /Date of birth/);
  assert.match(page, /Not recorded/);
  assert.match(page, /dateOfBirth: row\.dateOfBirth/);
  assert.match(formatter, /dateOfBirth: p\.dateOfBirth/);
  assert.doesNotMatch(formatter, /passwordHash/);
  assert.doesNotMatch(formatter, /accessCodeHash/);
  assert.equal(formatDateOfBirth("1980-03-29"), "03/29/1980");
  assert.equal(formatDateOfBirth(null), "Not recorded");
  assert.equal(formatDateOfBirth(""), "Not recorded");
});

test("a hospital email without a portal login does not claim that recovery email was sent", () => {
  const recovery = readRepo("artifacts/api-server/src/lib/portal-recovery.ts");
  const page = readRepo("artifacts/ace-results-portal/src/pages/recover.tsx");
  const admin = readRepo("artifacts/ace-results-portal/src/pages/admin/patients.tsx");
  const list = readRepo("artifacts/api-server/src/routes/patients.ts");
  assert.match(recovery, /no Patient Portal login for this record yet/);
  assert.doesNotMatch(recovery, /recovery instructions have been sent/);
  assert.match(page, /no Patient Portal login for this record yet/);
  assert.doesNotMatch(page, /recovery instructions have been sent/);
  assert.match(admin, /portalActive: row\.portalActive === true/);
  assert.doesNotMatch(admin, /portalActive: true/);
  assert.doesNotMatch(admin, /Username/);
  assert.doesNotMatch(admin, /split\("@\"\)/);
  assert.match(admin, /\["Patient", "HIS ID", "Email", "Results", "Access code request", "Portal", ""\]/);
  assert.match(list, /portalActive: p\.portalUserId != null && activePortalUserIds\.has\(p\.portalUserId\)/);
  assert.match(recovery, /if \(!portalAccount\.ok\)/);
});

test("recovery step 1 does not complete, and password reset follows OTP verification", () => {
  const page = readRepo("artifacts/ace-results-portal/src/pages/recover.tsx");
  const route = readRepo("artifacts/api-server/src/routes/portal.ts");
  const recovery = readRepo("artifacts/api-server/src/lib/portal-recovery.ts");
  assert.match(page, /\/api\/portal\/recover\/verify/);
  assert.match(page, /setStep\(1\)/);
  assert.match(page, /setStep\(2\)/);
  assert.match(page, /setStep\(3\)/);
  assert.doesNotMatch(page, /assistedRecovery[\s\S]{0,240}setStep\(3\)/);
  assert.doesNotMatch(page, /localStorage/);
  assert.doesNotMatch(page, /sessionStorage/);
  assert.match(route, /router\.post\("\/portal\/recover\/verify"/);
  assert.match(route, /otp_required/);
  assert.match(recovery, /markRecoveryOtpVerified/);
  assert.doesNotMatch(recovery, /console\.(log|info|debug)\(/);
});
