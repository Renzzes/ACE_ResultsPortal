import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  DEFAULT_MAX_FILE_BYTES,
  detectTypeFromMagic,
  ensureStorageReady,
  fileTypeFromExtension,
  fileTypeFromMime,
  finalizeStoredFile,
  getMaxFileBytes,
  getStoredFilePath,
  inspectStorage,
  normalizeStoredFileKey,
  resetResultStorageCache,
  resolveStorageRoot,
  sanitizeOriginalFileName,
  storedFileExists,
  validateStoredUpload,
  validateUploadClaims,
} from "@workspace/db";
import { canAccessResult, canPortalAccessResult } from "../../artifacts/api-server/src/lib/result-access";
import { standardDepartmentLookup } from "./department-test-fixture";
import type { ResultRow } from "@workspace/db";
import type { AuthUser } from "../../artifacts/api-server/src/middlewares/auth";

const previousStorageRoot = process.env.RESULT_STORAGE_ROOT;
let tempRoot = "";

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ace-result-storage-"));
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8");
}

function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

function fakeResult(overrides: Partial<ResultRow>): ResultRow {
  return {
    id: 1,
    patientId: 1,
    category: "laboratory",
    fileName: "results/1/result.pdf",
    originalFileName: "lab.pdf",
    fileType: "pdf",
    fileSizeBytes: 12,
    releaseOption: "manual",
    scheduledReleaseDate: null,
    dateReleased: null,
    status: "pending",
    remarks: null,
    uploadedById: 1,
    uploadedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function staff(role: AuthUser["role"], userId = 2): AuthUser {
  return { userId, username: `user-${role}`, role };
}

test.beforeEach(() => {
  tempRoot = makeRoot();
  process.env.RESULT_STORAGE_ROOT = tempRoot;
  resetResultStorageCache();
  ensureStorageReady();
});

test.afterEach(() => {
  resetResultStorageCache();
  if (previousStorageRoot === undefined) {
    delete process.env.RESULT_STORAGE_ROOT;
  } else {
    process.env.RESULT_STORAGE_ROOT = previousStorageRoot;
  }
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("valid PDF upload lands on an application-generated path", () => {
  const tmpName = `${randomUUID()}.pdf`;
  fs.writeFileSync(path.join(tempRoot, "tmp", tmpName), pdfBytes());
  const validated = validateStoredUpload(
    path.join(tempRoot, "tmp", tmpName),
    "report.pdf",
    "application/pdf",
    pdfBytes().length,
  );
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const relative = finalizeStoredFile(tmpName, 42, validated.fileType);
  assert.equal(relative, "results/42/result.pdf");
  assert.equal(storedFileExists(relative), true);
  assert.equal(fs.existsSync(path.join(tempRoot, "tmp", tmpName)), false);
  const stored = getStoredFilePath(relative);
  assert.equal(path.basename(stored), "result.pdf");
  assert.ok(stored.startsWith(path.resolve(tempRoot)));
  assert.equal(stored.includes("report.pdf"), false);
});

test("invalid extension is rejected", () => {
  const result = validateUploadClaims("payload.exe", "application/pdf");
  assert.equal(result.ok, false);
});

test("invalid MIME type is rejected", () => {
  const result = validateUploadClaims("report.pdf", "application/octet-stream");
  assert.equal(result.ok, false);
});

test("oversized file is rejected", () => {
  const tmpName = `${randomUUID()}.pdf`;
  const abs = path.join(tempRoot, "tmp", tmpName);
  fs.writeFileSync(abs, pdfBytes());
  const result = validateStoredUpload(abs, "report.pdf", "application/pdf", DEFAULT_MAX_FILE_BYTES + 1);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /maximum size/);
  }
});

test("path traversal and absolute names are rejected", () => {
  const rejected = [
    "../secret.pdf",
    "..\\secret.pdf",
    "results/1/../../../secret.pdf",
    "C:\\Windows\\secret.pdf",
    "D:/secret.pdf",
    "//server/share/secret.pdf",
    "\\\\server\\share\\secret.pdf",
    "results/1/result.pdf\0.pdf",
    "/var/secret.pdf",
  ];
  for (const name of rejected) {
    assert.throws(() => normalizeStoredFileKey(name), /Invalid file name/);
  }
});

test("missing stored file is reported as absent", () => {
  assert.equal(storedFileExists("results/999999/result.pdf"), false);
});

test("download authorization: physician is denied unless the result is released", async () => {
  const physician = staff("physician", 9);
  assert.equal(await canAccessResult(physician, fakeResult({ status: "pending" })), false);
  assert.equal(await canAccessResult(physician, fakeResult({ status: "archived" })), false);
});

test("unauthorized and pending/archived downloads stay denied for physician and portal", async () => {
  const pending = fakeResult({ status: "pending", patientId: 1 });
  const archived = fakeResult({ status: "archived", patientId: 1 });
  const releasedOther = fakeResult({ status: "released", patientId: 2 });

  assert.equal(await canAccessResult(staff("physician"), pending), false);
  assert.equal(await canAccessResult(staff("physician"), archived), false);
  assert.equal(canPortalAccessResult(pending, 1), false);
  assert.equal(canPortalAccessResult(archived, 1), false);
  assert.equal(canPortalAccessResult(releasedOther, 1), false);
  assert.equal(canPortalAccessResult(fakeResult({ status: "released", patientId: 1 }), 1), true);
});

test("authorized staff may access pending results; unauthenticated role cannot", async () => {
  const pending = fakeResult({ status: "pending" });
  assert.equal(await canAccessResult(staff("super_admin", 1), pending), true);
  assert.equal(
    await canAccessResult(staff("medical_records", 3), pending, {
      lookupDepartment: standardDepartmentLookup(),
    }),
    true,
  );
  assert.equal(await canAccessResult({ userId: 8, username: "nobody", role: "physician" }, pending), false);
});

test("storage path resolution is independent of process.cwd", () => {
  const first = resolveStorageRoot();
  const originalCwd = process.cwd();
  const other = path.join(originalCwd, "artifacts", "api-server");
  try {
    if (fs.existsSync(other)) {
      process.chdir(other);
    }
    resetResultStorageCache();
    const second = resolveStorageRoot();
    assert.equal(path.resolve(first), path.resolve(second));
    assert.equal(path.resolve(second), path.resolve(tempRoot));
  } finally {
    process.chdir(originalCwd);
  }
});

test("API restart cache reset still resolves the same storage root", () => {
  const first = resolveStorageRoot();
  resetResultStorageCache();
  const second = resolveStorageRoot();
  assert.equal(first, second);
});

test("orphan detection reports CASE A missing files and CASE B orphans", () => {
  const tmpName = `${randomUUID()}.pdf`;
  fs.writeFileSync(path.join(tempRoot, "tmp", tmpName), pdfBytes());
  finalizeStoredFile(tmpName, 7, "pdf");
  fs.writeFileSync(path.join(tempRoot, "orphan.bin"), Buffer.from("x"));

  const report = inspectStorage([
    { resultId: 7, fileName: "results/7/result.pdf" },
    { resultId: 8, fileName: "results/8/result.pdf" },
  ]);
  assert.equal(report.consistent.length, 1);
  assert.equal(report.missing.length, 1);
  assert.equal(report.missing[0]?.resultId, 8);
  assert.equal(report.missing[0]?.fileExists, false);
  assert.ok(report.orphans.some((item) => item.relativePath === "orphan.bin"));
});

test("client original filename never becomes the filesystem path", () => {
  const tmpName = `${randomUUID()}.pdf`;
  fs.writeFileSync(path.join(tempRoot, "tmp", tmpName), pdfBytes());
  const relative = finalizeStoredFile(tmpName, 15, "pdf");
  const stored = getStoredFilePath(relative);
  const original = sanitizeOriginalFileName("..\\..\\Patients\\Jane Doe\\lab.pdf");
  assert.equal(original, "lab.pdf");
  assert.equal(path.basename(stored), "result.pdf");
  assert.equal(stored.includes("Jane"), false);
  assert.equal(stored.includes("lab.pdf"), false);
});

test("MIME, extension, and magic bytes must agree", () => {
  assert.equal(fileTypeFromExtension("a.PDF"), "pdf");
  assert.equal(fileTypeFromMime("image/jpg"), "jpeg");
  assert.equal(detectTypeFromMagic(pdfBytes()), "pdf");
  assert.equal(detectTypeFromMagic(jpegBytes()), "jpeg");
  assert.equal(detectTypeFromMagic(pngBytes()), "png");

  const tmpName = `${randomUUID()}.png`;
  const abs = path.join(tempRoot, "tmp", tmpName);
  fs.writeFileSync(abs, pdfBytes());
  const result = validateStoredUpload(abs, "photo.png", "image/png", pdfBytes().length);
  assert.equal(result.ok, false);
});

test("default maximum file size is 50 MiB unless RESULT_MAX_FILE_BYTES is set", () => {
  const previous = process.env.RESULT_MAX_FILE_BYTES;
  delete process.env.RESULT_MAX_FILE_BYTES;
  try {
    assert.equal(getMaxFileBytes(), DEFAULT_MAX_FILE_BYTES);
    assert.equal(DEFAULT_MAX_FILE_BYTES, 50 * 1024 * 1024);
  } finally {
    if (previous === undefined) {
      delete process.env.RESULT_MAX_FILE_BYTES;
    } else {
      process.env.RESULT_MAX_FILE_BYTES = previous;
    }
  }
});
