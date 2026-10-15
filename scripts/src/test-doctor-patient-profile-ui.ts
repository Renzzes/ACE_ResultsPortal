/**
 * Doctor Patient Profile UI — comment wiring + layout contract.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("patient profile uses authorized results API and shared review endpoint", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/physician/patient-detail.tsx", import.meta.url),
    "utf8",
  );
  const preview = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/components/doctor/document-preview.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /useListPatientResultsPhysician/);
  assert.match(page, /ResultCommentDialog/);
  assert.match(page, /View and comment results/);
  assert.match(page, /Appointment information unavailable/);
  assert.match(preview, /\/api\/results\/\$\{resultId\}\/review/);
  assert.match(preview, /appears on Staff Desk|appears on the Staff Desk/);
  assert.equal(/localStorage/.test(page), false);
  assert.equal(/Female|ABAYATA/.test(page), false);
});

test("staff desk surfaces physician review comments from the same review model", () => {
  const desk = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/components/staff/dashboard-desk.tsx", import.meta.url),
    "utf8",
  );
  const notify = fs.readFileSync(
    new URL("../../artifacts/api-server/src/lib/notify-result-reviewed.ts", import.meta.url),
    "utf8",
  );
  assert.match(desk, /left a comment/);
  assert.match(desk, /StatusBadge label=\{hasComment \? "Comment" : "Reviewed"\}/);
  assert.match(notify, /result_reviewed/);
  assert.match(notify, /Doctor comment on result/);
});
