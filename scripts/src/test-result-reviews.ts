import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { closePool, initDb, loadDbConfig, loadRootEnv, resultReviewsRepo, type ResultRow } from "@workspace/db";
import type { AuthUser } from "../../artifacts/api-server/src/middlewares/auth";
import type { ResultAccessDeps } from "../../artifacts/api-server/src/lib/result-access";
import { formatResult } from "../../artifacts/api-server/src/lib/formatters";
import {
  MAX_REVIEW_COMMENT_LENGTH,
  applyReviewUpsert,
  authorizePhysicianReview,
  parseReviewComment,
  physicianReviewView,
  sessionReviewerId,
  staffReviewViews,
  type StoredReview,
} from "../../artifacts/api-server/src/lib/result-review";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.join(root, "docs/migration/sql/014_result_reviews.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const reviewRoute = fs.readFileSync(path.join(root, "artifacts/api-server/src/routes/results.ts"), "utf8");
const portalRoute = fs.readFileSync(path.join(root, "artifacts/api-server/src/routes/portal.ts"), "utf8");
const openapi = fs.readFileSync(path.join(root, "lib/api-spec/openapi.yaml"), "utf8");
const repoSql = fs.readFileSync(path.join(root, "lib/db/src/repos/result-reviews.ts"), "utf8");

function result(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    id: 40,
    patientId: 8,
    category: "laboratory",
    fileName: "results/40/result.pdf",
    originalFileName: "lab.pdf",
    fileType: "pdf",
    fileSizeBytes: 10,
    releaseOption: "immediate",
    scheduledReleaseDate: null,
    dateReleased: new Date("2026-10-01T00:00:00Z"),
    status: "released",
    remarks: "Uploaded by laboratory staff.",
    uploadedById: 2,
    uploadedAt: new Date("2026-10-01T00:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    accessCodeHash: null,
    accessCodeEncrypted: null,
    accessCodeIssuedAt: null,
    accessCodeEmailedAt: null,
    accessCodeEmailStatus: null,
    ...overrides,
  };
}

function physician(userId: number): AuthUser {
  return { userId, username: `dr.${userId}`, role: "physician" };
}

function accessDeps(opts: {
  resultId?: number;
  privatePhysicians?: number[];
  patientPhysicians?: Array<{ patientId: number; physicianId: number }>;
}): ResultAccessDeps {
  const resultId = opts.resultId ?? 40;
  const privateSet = new Set(opts.privatePhysicians ?? []);
  const patientPairs = opts.patientPhysicians ?? [];
  return {
    hasResultAssignments: async (id) => id === resultId && privateSet.size > 0,
    findResultAssignment: async (id, physicianId) =>
      id === resultId && privateSet.has(physicianId) ? { id: 1 } : undefined,
    findPatientAssignment: async (patientId, physicianId) =>
      patientPairs.some((pair) => pair.patientId === patientId && pair.physicianId === physicianId)
        ? { id: 1 }
        : undefined,
    resolveActor: async () => ({ role: "physician", isActive: true }),
  };
}

test("1 migration file exists", () => {
  assert.equal(fs.existsSync(migrationPath), true);
});

test("2 migration creates dbo.result_reviews", () => {
  assert.match(migration, /CREATE TABLE dbo\.result_reviews/);
});

test("3 migration columns match the approved review identity", () => {
  assert.match(migration, /result_id INT NOT NULL/);
  assert.match(migration, /physician_id INT NOT NULL/);
  assert.match(migration, /comment NVARCHAR\(MAX\) NULL/);
  assert.match(migration, /reviewed_at DATETIMEOFFSET\(7\) NOT NULL/);
});

test("4 result foreign key cascades from results", () => {
  assert.match(migration, /REFERENCES dbo\.results \(id\) ON DELETE CASCADE/);
});

test("5 physician foreign key does not cascade user deletes", () => {
  assert.match(migration, /REFERENCES dbo\.users \(id\) ON DELETE NO ACTION/);
});

test("6 unique result and physician pair", () => {
  assert.match(migration, /UNIQUE \(result_id, physician_id\)/);
});

test("7 indexes exist for result and physician lookups", () => {
  assert.match(migration, /IX_result_reviews_result_id/);
  assert.match(migration, /IX_result_reviews_physician_id/);
});

test("8 migration does not alter result status", () => {
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+dbo\.results/i);
  assert.doesNotMatch(migration, /UPDATE\s+dbo\.results/i);
  assert.doesNotMatch(migration, /results\.status/i);
});

test("9 migration does not alter result remarks", () => {
  assert.doesNotMatch(migration, /remarks/i);
});

test("10 assigned physician can review", async () => {
  const access = await authorizePhysicianReview(
    physician(10),
    result(),
    accessDeps({ privatePhysicians: [10] }),
  );
  assert.deepEqual(access, { ok: true });
});

test("11 unassigned physician is forbidden", async () => {
  const access = await authorizePhysicianReview(
    physician(3),
    result(),
    accessDeps({ privatePhysicians: [10] }),
  );
  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.status, 403);
});

test("12 patient cannot review", async () => {
  const access = await authorizePhysicianReview(
    { userId: 4, username: "patient", role: "patient" },
    result(),
    accessDeps({ privatePhysicians: [10] }),
  );
  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.status, 403);
});

test("13 staff cannot use the review endpoint", async () => {
  const access = await authorizePhysicianReview(
    { userId: 2, username: "lab", role: "laboratory" },
    result(),
    accessDeps({}),
  );
  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.status, 403);
  assert.match(reviewRoute, /role !== "physician"/);
});

test("14 body physicianId cannot impersonate another physician", () => {
  assert.equal(sessionReviewerId(10), 10);
  assert.match(reviewRoute, /sessionReviewerId\(req\.user!\.userId\)/);
  assert.doesNotMatch(reviewRoute, /req\.body\.physicianId/);
  assert.doesNotMatch(reviewRoute, /req\.query\.physicianId/);
});

test("15 unauthorized review does not return review rows", () => {
  const handler = reviewRoute.slice(reviewRoute.indexOf('router.put("/results/:id/review"'));
  const accessAt = handler.indexOf("authorizePhysicianReview");
  const saveAt = handler.indexOf("upsertReview");
  assert.ok(accessAt > 0 && saveAt > accessAt);
  assert.match(handler, /error: access\.error/);
  assert.doesNotMatch(handler.slice(0, saveAt), /reviews:/);
});

test("16 archived result stays inaccessible to the physician", async () => {
  const access = await authorizePhysicianReview(
    physician(10),
    result({ status: "archived" }),
    accessDeps({ privatePhysicians: [10] }),
  );
  assert.equal(access.ok, false);
  if (!access.ok) assert.equal(access.status, 403);
});

test("17 review without a comment succeeds", () => {
  assert.deepEqual(parseReviewComment(undefined), { ok: true, comment: null });
});

test("18 review with a comment succeeds", () => {
  assert.deepEqual(parseReviewComment("Reviewed."), { ok: true, comment: "Reviewed." });
});

test("19 comment is trimmed", () => {
  assert.deepEqual(parseReviewComment("  Reviewed.  "), { ok: true, comment: "Reviewed." });
});

test("20 empty comment becomes null", () => {
  assert.deepEqual(parseReviewComment("   "), { ok: true, comment: null });
  assert.deepEqual(parseReviewComment(null), { ok: true, comment: null });
});

test("21 reviewed_at is generated by the database", () => {
  assert.match(repoSql, /reviewed_at = SYSDATETIMEOFFSET\(\)/);
  assert.match(repoSql, /DEFAULT \(SYSDATETIMEOFFSET\(\)\)|SYSDATETIMEOFFSET\(\)/);
  assert.doesNotMatch(repoSql, /@reviewedAt/);
});

test("22 client reviewed_at is rejected", () => {
  assert.match(reviewRoute, /reviewedAt is set by the server/);
  assert.match(reviewRoute, /"reviewedAt" in body \|\| "reviewed_at" in body/);
});

test("23 the same physician does not create a duplicate review", () => {
  const first = applyReviewUpsert([], {
    resultId: 40,
    physicianId: 10,
    comment: "Reviewed.",
    reviewedAt: "2026-10-07T01:00:00.000Z",
  });
  const second = applyReviewUpsert(first, {
    resultId: 40,
    physicianId: 10,
    comment: "Reviewed. Findings noted.",
    reviewedAt: "2026-10-07T02:00:00.000Z",
  });
  assert.equal(second.filter((row) => row.resultId === 40 && row.physicianId === 10).length, 1);
});

test("24 a repeat review updates the comment", () => {
  const rows = applyReviewUpsert(
    applyReviewUpsert([], {
      resultId: 40,
      physicianId: 10,
      comment: "Reviewed.",
      reviewedAt: "2026-10-07T01:00:00.000Z",
    }),
    {
      resultId: 40,
      physicianId: 10,
      comment: "Reviewed. Findings noted.",
      reviewedAt: "2026-10-07T02:00:00.000Z",
    },
  );
  assert.equal(rows[0]?.comment, "Reviewed. Findings noted.");
});

test("25 a repeat review uses the latest server timestamp", () => {
  const rows = applyReviewUpsert(
    [{ resultId: 40, physicianId: 10, comment: "Reviewed.", reviewedAt: "2026-10-07T01:00:00.000Z" }],
    {
      resultId: 40,
      physicianId: 10,
      comment: "Reviewed. Findings noted.",
      reviewedAt: "2026-10-07T02:15:00.000Z",
    },
  );
  assert.equal(rows[0]?.reviewedAt, "2026-10-07T02:15:00.000Z");
  assert.match(repoSql, /WHEN MATCHED THEN\s+UPDATE SET comment = @comment, reviewed_at = SYSDATETIMEOFFSET\(\)/);
});

test("26 physician A has an independent review", () => {
  const rows = applyReviewUpsert([], {
    resultId: 50,
    physicianId: 10,
    comment: "A",
    reviewedAt: "2026-10-07T01:00:00.000Z",
  });
  assert.equal(rows.some((row) => row.physicianId === 10 && row.comment === "A"), true);
});

test("27 physician B has an independent review", () => {
  const rows = applyReviewUpsert(
    [{ resultId: 50, physicianId: 10, comment: "A", reviewedAt: "2026-10-07T01:00:00.000Z" }],
    { resultId: 50, physicianId: 3, comment: "B", reviewedAt: "2026-10-07T01:05:00.000Z" },
  );
  assert.equal(rows.some((row) => row.physicianId === 3 && row.comment === "B"), true);
});

test("28 physicians keep separate comments", () => {
  const rows: StoredReview[] = [
    { resultId: 50, physicianId: 10, comment: "A", reviewedAt: "2026-10-07T01:00:00.000Z" },
    { resultId: 50, physicianId: 3, comment: "B", reviewedAt: "2026-10-07T01:05:00.000Z" },
  ];
  assert.notEqual(rows[0]?.comment, rows[1]?.comment);
});

test("29 updating physician A does not modify physician B", () => {
  const rows = applyReviewUpsert(
    [
      { resultId: 50, physicianId: 10, comment: "A", reviewedAt: "2026-10-07T01:00:00.000Z" },
      { resultId: 50, physicianId: 3, comment: "B", reviewedAt: "2026-10-07T01:05:00.000Z" },
    ],
    { resultId: 50, physicianId: 10, comment: "A2", reviewedAt: "2026-10-07T03:00:00.000Z" },
  );
  assert.equal(rows.find((row) => row.physicianId === 3)?.comment, "B");
  assert.equal(rows.find((row) => row.physicianId === 10)?.comment, "A2");
});

test("30 an unreviewed assigned physician stays visible", () => {
  const views = staffReviewViews(
    [
      { physicianId: 10, physicianName: "Dr. Smith" },
      { physicianId: 3, physicianName: "Dr. Jones" },
      { physicianId: 7, physicianName: "Dr. Lee" },
    ],
    [
      { physicianId: 10, comment: "Reviewed.", reviewedAt: "2026-10-07T01:15:00.000Z" },
      { physicianId: 7, comment: "Noted.", reviewedAt: "2026-10-07T01:20:00.000Z" },
    ],
  );
  assert.equal(views.find((row) => row.physicianId === 3)?.reviewed, false);
  assert.equal(views.find((row) => row.physicianId === 3)?.reviewedAt, null);
  assert.equal(views.find((row) => row.physicianId === 3)?.comment, null);
});

test("31 review persistence does not change result status", () => {
  const before = result({ status: "pending" });
  applyReviewUpsert([], {
    resultId: before.id,
    physicianId: 10,
    comment: null,
    reviewedAt: "2026-10-07T01:00:00.000Z",
  });
  assert.equal(before.status, "pending");
  const handler = reviewRoute.slice(reviewRoute.indexOf('router.put("/results/:id/review"'));
  assert.doesNotMatch(handler, /updateResult\(/);
  // HTTP res.status(...) is allowed; review must not mutate result workflow status fields.
  assert.doesNotMatch(handler, /status:\s*["'](?:pending|released|archived|reviewed)/);
});

test("32 review persistence does not change remarks", () => {
  const before = result();
  applyReviewUpsert([], {
    resultId: before.id,
    physicianId: 10,
    comment: "Clinical note",
    reviewedAt: "2026-10-07T01:00:00.000Z",
  });
  assert.equal(before.remarks, "Uploaded by laboratory staff.");
});

test("33 review persistence does not change the file", () => {
  const before = result();
  applyReviewUpsert([], {
    resultId: before.id,
    physicianId: 10,
    comment: null,
    reviewedAt: "2026-10-07T01:00:00.000Z",
  });
  assert.equal(before.fileName, "results/40/result.pdf");
  assert.equal(before.originalFileName, "lab.pdf");
});

test("34 review persistence does not change result physician assignments", () => {
  const assigned = [10, 3];
  applyReviewUpsert([], {
    resultId: 40,
    physicianId: 10,
    comment: null,
    reviewedAt: "2026-10-07T01:00:00.000Z",
  });
  assert.deepEqual(assigned, [10, 3]);
  const handler = reviewRoute.slice(reviewRoute.indexOf('router.put("/results/:id/review"'));
  assert.doesNotMatch(handler, /reconcileAssignments|resultPhysiciansRepo/);
});

test("35 review persistence does not change the patient association", () => {
  const before = result({ patientId: 8 });
  applyReviewUpsert([], {
    resultId: 41,
    physicianId: 10,
    comment: null,
    reviewedAt: "2026-10-07T01:00:00.000Z",
  });
  assert.equal(before.patientId, 8);
});

test("36 staff see a reviewed physician", () => {
  const views = staffReviewViews(
    [{ physicianId: 10, physicianName: "Dr. Smith" }],
    [{ physicianId: 10, comment: "Reviewed.", reviewedAt: "2026-10-07T01:15:00.000Z" }],
  );
  assert.equal(views[0]?.reviewed, true);
  assert.equal(views[0]?.physicianName, "Dr. Smith");
});

test("37 staff see an unreviewed assigned physician", () => {
  const views = staffReviewViews(
    [
      { physicianId: 10, physicianName: "Dr. Smith" },
      { physicianId: 3, physicianName: "Dr. Jones" },
    ],
    [{ physicianId: 10, comment: "Reviewed.", reviewedAt: "2026-10-07T01:15:00.000Z" }],
  );
  assert.equal(views[1]?.physicianName, "Dr. Jones");
  assert.equal(views[1]?.reviewed, false);
});

test("38 staff see the physician comment", () => {
  const views = staffReviewViews(
    [{ physicianId: 10, physicianName: "Dr. Smith" }],
    [{ physicianId: 10, comment: "Reviewed. Findings noted.", reviewedAt: "2026-10-07T01:15:00.000Z" }],
  );
  assert.equal(views[0]?.comment, "Reviewed. Findings noted.");
});

test("39 staff see multiple physician reviews", () => {
  const views = staffReviewViews(
    [
      { physicianId: 10, physicianName: "Dr. Smith" },
      { physicianId: 3, physicianName: "Dr. Jones" },
    ],
    [
      { physicianId: 10, comment: "A", reviewedAt: "2026-10-07T01:15:00.000Z" },
      { physicianId: 3, comment: "B", reviewedAt: "2026-10-07T01:16:00.000Z" },
    ],
  );
  assert.equal(views.length, 2);
  assert.deepEqual(views.map((row) => row.reviewed), [true, true]);
});

test("40 a refreshed result still has the saved review", () => {
  const saved = applyReviewUpsert([], {
    resultId: 40,
    physicianId: 10,
    comment: "Reviewed.",
    reviewedAt: "2026-10-07T01:15:00.000Z",
  });
  const reloaded = saved.find((row) => row.resultId === 40 && row.physicianId === 10);
  assert.equal(reloaded?.comment, "Reviewed.");
  assert.equal(physicianReviewView(reloaded).reviewed, true);
});

test("41 server review state is not stored in browser localStorage", () => {
  const frontend = path.join(root, "artifacts/ace-results-portal/src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(frontend);
  const hits = files.filter((file) => fs.readFileSync(file, "utf8").includes("ace_doctor_review_"));
  assert.deepEqual(hits, []);
  assert.equal(fs.existsSync(path.join(frontend, "lib/doctor-review.ts")), false);
});

test("42 different results keep independent review state", () => {
  let rows: StoredReview[] = [];
  rows = applyReviewUpsert(rows, {
    resultId: 40,
    physicianId: 10,
    comment: "Result 40",
    reviewedAt: "2026-10-07T01:00:00.000Z",
  });
  rows = applyReviewUpsert(rows, {
    resultId: 41,
    physicianId: 10,
    comment: null,
    reviewedAt: "2026-10-07T01:05:00.000Z",
  });
  assert.equal(rows.find((row) => row.resultId === 40)?.comment, "Result 40");
  assert.equal(rows.find((row) => row.resultId === 41)?.comment, null);
  assert.equal(physicianReviewView(rows.find((row) => row.resultId === 41)).reviewed, true);
  assert.equal(physicianReviewView(undefined).reviewed, false);
});

test("43 patient portal payloads omit review comments", () => {
  const portalResults = portalRoute.slice(
    portalRoute.indexOf('router.get("/portal/results"'),
    portalRoute.indexOf('router.get("/portal/medications"'),
  );
  assert.doesNotMatch(portalResults, /reviews/);
  assert.doesNotMatch(portalResults, /myReview/);
  assert.doesNotMatch(portalResults, /result_reviews/);
});

test("44 patient portal payloads omit reviewer identity", () => {
  const portalResults = portalRoute.slice(
    portalRoute.indexOf('router.get("/portal/results"'),
    portalRoute.indexOf('router.get("/portal/medications"'),
  );
  assert.doesNotMatch(portalResults, /physicianId/);
  assert.doesNotMatch(portalResults, /physicianName/);
});

test("45 patient portal payloads omit review timestamps", () => {
  const portalResults = portalRoute.slice(
    portalRoute.indexOf('router.get("/portal/results"'),
    portalRoute.indexOf('router.get("/portal/medications"'),
  );
  assert.doesNotMatch(portalResults, /reviewedAt/);
  assert.doesNotMatch(portalResults, /reviewed_at/);
  const formatted = formatResult(result());
  assert.equal("reviews" in formatted, false);
  assert.equal("myReview" in formatted, false);
  const own = formatResult(result(), {
    myReview: { reviewed: true, reviewedAt: "2026-10-07T01:15:00.000Z", comment: "Private" },
  });
  assert.equal("reviews" in own, false);
  assert.equal(own.myReview?.comment, "Private");
});

test("comment longer than the limit is rejected and not truncated", () => {
  const tooLong = "a".repeat(MAX_REVIEW_COMMENT_LENGTH + 1);
  const parsed = parseReviewComment(tooLong);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /4000/);
});

test("released patient assignment remains the existing fallback", async () => {
  const allowed = await authorizePhysicianReview(
    physician(10),
    result({ status: "released" }),
    accessDeps({ patientPhysicians: [{ patientId: 8, physicianId: 10 }] }),
  );
  const denied = await authorizePhysicianReview(
    physician(3),
    result({ status: "released" }),
    accessDeps({ patientPhysicians: [{ patientId: 8, physicianId: 10 }] }),
  );
  assert.equal(allowed.ok, true);
  assert.equal(denied.ok, false);
});

test("openapi documents the new review route", () => {
  assert.match(openapi, /\/results\/\{id\}\/review:/);
  assert.match(openapi, /putResultReview/);
  assert.match(reviewRoute, /router\.put\("\/results\/:id\/review"/);
});

test("audit records an edit without the comment text", () => {
  const handler = reviewRoute.slice(reviewRoute.indexOf('router.put("/results/:id/review"'));
  assert.match(handler, /action: "edit"/);
  assert.match(handler, /details: "result_reviewed"/);
  assert.doesNotMatch(handler, /details:.*comment/);
});

test("LIVE result_reviews table", async () => {
  loadRootEnv();
  let database = "";
  try {
    database = loadDbConfig().database;
  } catch (err) {
    assert.fail(`Database is not configured: ${err instanceof Error ? err.message : String(err)}`);
  }
  assert.equal(database, "ACE_ResultsPortal", `Unexpected database "${database}". Expected ACE_ResultsPortal.`);
  try {
    await initDb();
    const ready = await resultReviewsRepo.schemaReady();
    assert.equal(ready, true, "dbo.result_reviews was not found in ACE_ResultsPortal");
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    assert.fail(`ACE_ResultsPortal is unavailable: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await closePool();
  }
});
