/**
 * Physician Patient Results page — layout + comment wiring.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  isAwaitingReview,
  isPendingStatus,
  isReleased,
  resultInDateBucket,
} from "../../artifacts/ace-results-portal/src/lib/doctor-results";

test("result KPI helpers classify released, pending, and review state", () => {
  const base = {
    id: 1,
    patientId: 1,
    category: "laboratory" as const,
    fileName: "a.pdf",
    originalFileName: "a.pdf",
    fileType: "pdf" as const,
    releaseOption: "immediate" as const,
    uploadedById: 1,
    uploadedAt: "2026-10-15T02:15:00.000Z",
    createdAt: "2026-10-15T02:15:00.000Z",
  };
  assert.equal(isReleased({ ...base, status: "released" }), true);
  assert.equal(isPendingStatus({ ...base, id: 2, status: "pending" }), true);
  assert.equal(isAwaitingReview({ ...base, id: 3, status: "released" }), null);
  assert.equal(
    isAwaitingReview({
      ...base,
      id: 4,
      status: "pending",
      myReview: { reviewed: false, reviewedAt: null, comment: null },
    }),
    true,
  );
  assert.equal(
    isAwaitingReview({
      ...base,
      id: 5,
      status: "released",
      myReview: { reviewed: true, reviewedAt: "2026-10-15T03:00:00.000Z", comment: "ok" },
    }),
    false,
  );
  assert.equal(resultInDateBucket("2026-10-15T02:15:00.000Z", "all"), true);
});

test("Patient Results page uses listResults and header Comment dialog only", () => {
  const page = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/pages/physician/results.tsx", import.meta.url),
    "utf8",
  );
  const preview = fs.readFileSync(
    new URL("../../artifacts/ace-results-portal/src/components/doctor/document-preview.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /useListResults/);
  assert.match(page, /variant="results"/);
  assert.match(page, /fetchDoctorResultStats/);
  assert.match(preview, /ResultCommentDialog/);
  assert.match(preview, /\/api\/results\/\$\{resultId\}\/review/);
  assert.equal(/DoctorCommentPanel/.test(preview), false);
  assert.equal(/Doctor's Comment \(Optional\)/.test(preview), false);
  assert.equal(/ABAYATA|Female/.test(page), false);
});
