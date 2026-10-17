/**
 * Render print-ready PDF pages to PNG and verify access-code headers on every page.
 * Uses pdfjs-dist + @napi-rs/canvas (local only). Does not use LiveDB or production storage.
 *
 * Important: assign napi-rs Path2D/DOMMatrix to globalThis BEFORE importing pdfjs,
 * otherwise pdfjs installs incompatible polyfills and canvas paintChar throws InvalidArg.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });

const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

const repoRoot = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(repoRoot, "artifacts", "test-output", "pdf-visual");
// NodeStandardFontDataFactory uses fs.readFile(url) — pass a filesystem path, not file://.
const standardFontDataUrl =
  path.join(
    repoRoot,
    "node_modules/.pnpm/pdfjs-dist@4.10.38/node_modules/pdfjs-dist/standard_fonts",
  ) + path.sep;

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

async function buildClinicalPdf(pages: number, nearBottom = false): Promise<Buffer> {
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = src.addPage([612, 792]);
    const { height } = page.getSize();
    page.drawText(`ACE SYNTHETIC REPORT — Page ${i + 1}`, {
      x: 48,
      y: height - 72,
      size: 14,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText("Patient demographics: SYNTHETIC-TEST / DOB 1990-01-01", {
      x: 48,
      y: height - 96,
      size: 11,
      font,
    });
    page.drawText("Findings: hemoglobin within reference range. No critical values.", {
      x: 48,
      y: nearBottom ? 48 : height / 2,
      size: 11,
      font,
    });
    page.drawText("Interpretation / signature block remains below the stamped header.", {
      x: 48,
      y: nearBottom ? 28 : height / 2 - 20,
      size: 10,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
  }
  return Buffer.from(await src.save());
}

async function openPdf(pdfBytes: Uint8Array) {
  return getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl,
  }).promise;
}

async function pageText(pdf: Awaited<ReturnType<typeof openPdf>>, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map((item) => ("str" in item ? String(item.str) : "")).join(" ");
}

async function renderPagesToPng(pdfBytes: Uint8Array, stem: string, expectedCode: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const pdf = await openPdf(pdfBytes);
  const paths: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const filePath = path.join(outDir, `${stem}-page-${pageNum}.png`);
    const png = canvas.toBuffer("image/png");
    // Blank/header-only renders (failed font load) stay ~11KB; successful text renders are much larger.
    assert.ok(png.byteLength > 40000, `${stem} page ${pageNum} PNG too small (${png.byteLength}) — likely blank glyphs`);
    fs.writeFileSync(filePath, png);
    paths.push(filePath);

    const joined = await pageText(pdf, pageNum);
    assert.match(joined, /DIGITAL COPY ACCESS CODE:/i, `page ${pageNum} missing header label`);
    assert.match(joined, new RegExp(expectedCode), `page ${pageNum} missing document code`);
    assert.match(joined, /ACE Medical Center Cebu/i, `page ${pageNum} missing brand header`);
  }
  return paths;
}

describe("print-ready visual headers", () => {
  test("renderer metadata recorded", () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "node_modules/.pnpm/pdfjs-dist@4.10.38/node_modules/pdfjs-dist/package.json"),
        "utf8",
      ),
    ) as { version: string };
    const canvasPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "scripts/node_modules/@napi-rs/canvas/package.json"),
        "utf8",
      ),
    ) as { version: string };
    console.log(`PDF_RENDERER=pdfjs-dist@${pkg.version} + @napi-rs/canvas@${canvasPkg.version}`);
    assert.ok(pkg.version);
    assert.ok(canvasPkg.version);
  });

  test("one-page: header code present, original unchanged, PNG rendered", async () => {
    const { buildPrintReadyPdf } = await loadPrintLib();
    const original = await buildClinicalPdf(1);
    const originalCopy = Buffer.from(original);
    const code = "ACE-VISUAL-1PAGE";
    const stamped = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: "pdf",
      accessCode: code,
      documentLabel: "one.pdf",
    });
    assert.equal(Buffer.compare(original, originalCopy), 0);
    const out = await PDFDocument.load(stamped);
    assert.equal(out.getPageCount(), 1);
    const pngs = await renderPagesToPng(stamped, "one-page", code);
    assert.equal(pngs.length, 1);
    assert.ok(fs.statSync(pngs[0]!).size > 1000);
  });

  test("three-page: every page has code header; no trailing page", async () => {
    const { buildPrintReadyPdf } = await loadPrintLib();
    const original = await buildClinicalPdf(3, true);
    const code = "ACE-VISUAL-MULTI";
    const stamped = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: "pdf",
      accessCode: code,
      documentLabel: "multi.pdf",
    });
    const out = await PDFDocument.load(stamped);
    assert.equal(out.getPageCount(), 3);
    const pngs = await renderPagesToPng(stamped, "three-page", code);
    assert.equal(pngs.length, 3);
    for (let i = 1; i <= 3; i++) {
      const pdf = await openPdf(stamped);
      const joined = await pageText(pdf, i);
      assert.match(joined, new RegExp(code), `page ${i} missing document code`);
      assert.doesNotMatch(joined, /ACE-VISUAL-1PAGE/);
    }
  });

  test("distinct documents produce distinct header codes", async () => {
    const { buildPrintReadyPdf } = await loadPrintLib();
    const original = await buildClinicalPdf(1);
    const a = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: "pdf",
      accessCode: "CODE-DOC-A",
      documentLabel: "a.pdf",
    });
    const b = await buildPrintReadyPdf({
      originalBytes: original,
      fileType: "pdf",
      accessCode: "CODE-DOC-B",
      documentLabel: "b.pdf",
    });
    assert.notEqual(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
    await renderPagesToPng(a, "doc-a", "CODE-DOC-A");
    await renderPagesToPng(b, "doc-b", "CODE-DOC-B");
  });
});
