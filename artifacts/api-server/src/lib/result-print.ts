import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const HEADER_HEIGHT = 36;

/**
 * Build a print-ready PDF with the document access code in the header of every page.
 * Does not modify the original stored file bytes passed in.
 */
export async function buildPrintReadyPdf(input: {
  originalBytes: Buffer;
  fileType: "pdf" | "jpeg" | "png";
  accessCode: string;
  documentLabel: string;
}): Promise<Uint8Array> {
  if (input.fileType === "pdf") {
    return stampPdfPages(input.originalBytes, input.accessCode);
  }
  return wrapImageAsPrintPdf(input.originalBytes, input.fileType, input.accessCode, input.documentLabel);
}

async function stampPdfPages(originalBytes: Buffer, accessCode: string): Promise<Uint8Array> {
  const src = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const stamped = await PDFDocument.create();
  const bold = await stamped.embedFont(StandardFonts.HelveticaBold);
  const regular = await stamped.embedFont(StandardFonts.Helvetica);
  const pageCount = src.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    const srcPage = src.getPage(i);
    const { width, height } = srcPage.getSize();
    const available = Math.max(height - HEADER_HEIGHT, height * 0.85);
    const scale = Math.min(1, available / height);
    const page = stamped.addPage([width, height]);

    page.drawRectangle({
      x: 0,
      y: height - HEADER_HEIGHT,
      width,
      height: HEADER_HEIGHT,
      color: rgb(0.95, 0.97, 0.95),
    });
    page.drawLine({
      start: { x: 0, y: height - HEADER_HEIGHT },
      end: { x: width, y: height - HEADER_HEIGHT },
      thickness: 0.5,
      color: rgb(0.75, 0.82, 0.78),
    });
    page.drawText("ACE Medical Center Cebu", {
      x: 14,
      y: height - 12,
      size: 8,
      font: regular,
      color: rgb(0.15, 0.25, 0.2),
    });
    page.drawText(`DIGITAL COPY ACCESS CODE: ${accessCode}`, {
      x: 14,
      y: height - 26,
      size: 10,
      font: bold,
      color: rgb(0.05, 0.35, 0.22),
    });
    const tip = "Use this code to unlock this document in the ACE Results Portal.";
    page.drawText(tip, {
      x: Math.max(14, width - regular.widthOfTextAtSize(tip, 7) - 14),
      y: height - 12,
      size: 7,
      font: regular,
      color: rgb(0.4, 0.45, 0.42),
    });

    const embeddedPage = await stamped.embedPage(srcPage);
    page.drawPage(embeddedPage, {
      x: (width - width * scale) / 2,
      y: 0,
      xScale: scale,
      yScale: scale,
    });
  }

  return stamped.save();
}

async function wrapImageAsPrintPdf(
  bytes: Buffer,
  fileType: "jpeg" | "png",
  accessCode: string,
  documentLabel: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({
    x: 0,
    y: height - HEADER_HEIGHT,
    width,
    height: HEADER_HEIGHT,
    color: rgb(0.95, 0.97, 0.95),
  });
  page.drawText("ACE Medical Center Cebu", {
    x: 14,
    y: height - 12,
    size: 8,
    font: regular,
    color: rgb(0.15, 0.25, 0.2),
  });
  page.drawText(`DIGITAL COPY ACCESS CODE: ${accessCode}`, {
    x: 14,
    y: height - 26,
    size: 10,
    font: bold,
    color: rgb(0.05, 0.35, 0.22),
  });

  const image =
    fileType === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const maxW = width - 48;
  const maxH = height - HEADER_HEIGHT - 48;
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  page.drawImage(image, {
    x: (width - drawW) / 2,
    y: (height - HEADER_HEIGHT - drawH) / 2,
    width: drawW,
    height: drawH,
  });
  page.drawText(documentLabel.slice(0, 80), {
    x: 14,
    y: 18,
    size: 8,
    font: regular,
    color: rgb(0.4, 0.45, 0.42),
  });
  return doc.save();
}
