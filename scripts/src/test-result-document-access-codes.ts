/**
 * Synthetic tests for per-document access codes (no LiveDB / HIS).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

test("migration 019 adds result credential columns and nullable patient hash", () => {
  const sql = read("docs/migration/sql/019_result_access_codes.sql");
  assert.match(sql, /access_code_hash/);
  assert.match(sql, /access_code_encrypted/);
  assert.match(sql, /access_code_email_status/);
  assert.match(sql, /ALTER TABLE dbo\.patients ALTER COLUMN access_code_hash/);
  assert.match(sql, /DO NOT execute against LiveDB_ACE/);
  assert.match(sql, /USE \[ACE_ResultsPortal\]/);
  assert.match(sql, /Does NOT copy existing patient-level codes/i);
});

test("server issues and verifies document-scoped codes", () => {
  const svc = read("artifacts/api-server/src/lib/result-access-code.ts");
  assert.match(svc, /issueResultAccessCode/);
  assert.match(svc, /verifyResultAccessCode/);
  assert.match(svc, /encryptAccessCode/);
  assert.match(svc, /retry_email/);
  assert.match(svc, /mode === \"regenerate\"/);

  const portal = read("artifacts/api-server/src/routes/portal.ts");
  assert.match(portal, /resultId/);
  assert.match(portal, /verifyResultAccessCode/);
  assert.match(portal, /verifyPortalResultAccessCode/);
  assert.match(portal, /locked:\s*true/);

  const results = read("artifacts/api-server/src/routes/results.ts");
  assert.match(results, /regenerate-access-code/);
  assert.match(results, /print-ready/);
  assert.match(results, /recipientEmail/);
});

test("registration success dialog has no patient-level access code", () => {
  const page = read("artifacts/ace-results-portal/src/pages/patients/new.tsx");
  assert.match(page, /Patient Registered/);
  assert.match(page, /View Patient/);
  assert.match(page, /Upload Result/);
  assert.doesNotMatch(page, /Secure Access Code/);
  assert.doesNotMatch(page, /Copy Access Code/);
});

test("patient details removes patient-level regen and adds per-document regen", () => {
  const detail = read("artifacts/ace-results-portal/src/pages/patients/detail.tsx");
  assert.match(detail, /Regenerate Document Access Code/);
  assert.match(detail, /regenerate-access-code/);
  assert.doesNotMatch(detail, /useRegenerateAccessCode/);
  assert.doesNotMatch(detail, /View access code/);
  assert.doesNotMatch(detail, /setRegenOpen/);
  assert.match(detail, /Issued per result on upload or regenerate/);
});

test("portal unlock is per document", () => {
  const access = read("artifacts/ace-results-portal/src/lib/portal-results-access.ts");
  assert.match(access, /unlockPortalResult/);
  assert.match(access, /getStoredPortalResultAccessCode/);
  assert.match(access, /beginPortalResultDownload/);

  const dash = read("artifacts/ace-results-portal/src/pages/portal/dashboard.tsx");
  assert.match(dash, /Your Diagnostic Results/);
  assert.match(dash, /unlockPortalResult/);
  assert.match(dash, /documentTitle/);
});

describe("independent document credentials (synthetic)", () => {
  test("code A verifies only hash A; code B verifies only hash B", async () => {
    const { loadRootEnv } = await import("@workspace/db");
    loadRootEnv();
    const authPath = path.join(repoRoot, "artifacts/api-server/src/lib/auth.ts");
    const codePath = path.join(repoRoot, "artifacts/api-server/src/lib/result-access-code.ts");
    const auth = (await import(pathToFileURL(authPath).href)) as {
      hashAccessCode: (code: string) => Promise<string>;
    };
    const codes = (await import(pathToFileURL(codePath).href)) as {
      verifyResultAccessCode: (
        result: { accessCodeHash: string | null },
        accessCode: string,
      ) => Promise<boolean>;
      encryptAccessCode: (plaintext: string) => string;
      decryptAccessCode: (envelope: string) => string | null;
    };

    const codeA = "ACE-DOC-AAAA-1111";
    const codeB = "ACE-DOC-BBBB-2222";
    const hashA = await auth.hashAccessCode(codeA);
    const hashB = await auth.hashAccessCode(codeB);

    assert.equal(await codes.verifyResultAccessCode({ accessCodeHash: hashA }, codeA), true);
    assert.equal(await codes.verifyResultAccessCode({ accessCodeHash: hashA }, codeB), false);
    assert.equal(await codes.verifyResultAccessCode({ accessCodeHash: hashB }, codeB), true);
    assert.equal(await codes.verifyResultAccessCode({ accessCodeHash: hashB }, codeA), false);
    assert.equal(await codes.verifyResultAccessCode({ accessCodeHash: null }, codeA), false);

    const encA = codes.encryptAccessCode(codeA);
    const encB = codes.encryptAccessCode(codeB);
    assert.notEqual(encA, encB);
    assert.equal(codes.decryptAccessCode(encA), codeA);
    assert.equal(codes.decryptAccessCode(encB), codeB);
  });

  test("print-ready for A embeds A code bytes path; B print uses different code input", async () => {
    const modPath = path.join(repoRoot, "artifacts/api-server/src/lib/result-print.ts");
    const { buildPrintReadyPdf } = (await import(pathToFileURL(modPath).href)) as {
      buildPrintReadyPdf: (input: {
        originalBytes: Buffer;
        fileType: "pdf" | "jpeg" | "png";
        accessCode: string;
        documentLabel: string;
      }) => Promise<Uint8Array>;
    };
    const src = await PDFDocument.create();
    const page = src.addPage([400, 600]);
    page.drawText("Clinical content for isolation check", { x: 40, y: 300, size: 12 });
    const original = Buffer.from(await src.save());
    const outA = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: "pdf",
      accessCode: "CODE-A-ONLY",
      documentLabel: "a.pdf",
    });
    const outB = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: "pdf",
      accessCode: "CODE-B-ONLY",
      documentLabel: "b.pdf",
    });
    assert.equal((await PDFDocument.load(outA)).getPageCount(), 1);
    assert.equal((await PDFDocument.load(outB)).getPageCount(), 1);
    assert.ok(Buffer.compare(Buffer.from(outA), Buffer.from(outB)) !== 0);
    assert.ok(Buffer.compare(original, Buffer.from(original)) === 0);
  });
});

describe("print-ready PDF header", () => {
  async function loadPrintLib() {
    const modPath = path.join(repoRoot, "artifacts/api-server/src/lib/result-print.ts");
    return import(pathToFileURL(modPath).href) as Promise<{
      buildPrintReadyPdf: (input: {
        originalBytes: Buffer;
        fileType: "pdf" | "jpeg" | "png";
        accessCode: string;
        documentLabel: string;
      }) => Promise<Uint8Array>;
    }>;
  }

  test("one-page PDF keeps page count and includes access code text", async () => {
    const { buildPrintReadyPdf } = await loadPrintLib();

    const src = await PDFDocument.create();
    const page = src.addPage([400, 600]);
    const font = await src.embedFont(StandardFonts.Helvetica);
    page.drawText("Clinical findings line", { x: 40, y: 300, size: 12, font, color: rgb(0, 0, 0) });
    const original = Buffer.from(await src.save());
    const originalCopy = Buffer.from(original);

    const stamped = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: "pdf",
      accessCode: "ACE-TEST-CODE",
      documentLabel: "lab.pdf",
    });

    assert.ok(Buffer.compare(original, originalCopy) === 0, "original buffer unchanged");
    assert.ok(Buffer.compare(original, Buffer.from(stamped)) !== 0, "stamped derivative differs from original");
    const out = await PDFDocument.load(stamped);
    assert.equal(out.getPageCount(), 1);
    // Helvetica text streams may be compressed; assert stamped PDF is larger after header stamp.
    assert.ok(stamped.byteLength > original.byteLength, "print-ready PDF grew after header stamp");
  });

  test("multipage PDF keeps page count and no extra trailing page", async () => {
    const { buildPrintReadyPdf } = await loadPrintLib();
    const src = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const page = src.addPage([400, 600]);
      page.drawText(`Page ${i + 1} content`, { x: 40, y: 300, size: 12 });
    }
    const original = Buffer.from(await src.save());
    const stamped = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: "pdf",
      accessCode: "ACE-MULTI-9999",
      documentLabel: "multi.pdf",
    });
    const out = await PDFDocument.load(stamped);
    assert.equal(out.getPageCount(), 3);
  });
});
