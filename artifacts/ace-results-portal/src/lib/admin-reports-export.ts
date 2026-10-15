import { jsPDF } from "jspdf";
import { publicAsset } from "@/components/layout/auth-split-layout";
import { formatDept, formatManilaDateTime } from "@/lib/admin-reports-range";

export type AdminReportExportKpi = {
  label: string;
  value: string;
  delta?: string | null;
};

export type AdminReportExportRow = {
  label: string;
  value: string;
};

export type AdminReportExportSection = {
  title: string;
  rows: AdminReportExportRow[];
};

export type AdminReportExportPayload = {
  rangeLabel: string;
  generatedAt: Date;
  kpis: AdminReportExportKpi[];
  departments: AdminReportExportRow[];
  dailyActivity: AdminReportExportRow[];
  topUploaders: AdminReportExportRow[];
  resultsSnapshot: AdminReportExportRow[];
  usersSnapshot: AdminReportExportRow[];
  securitySnapshot: AdminReportExportRow[];
  systemSnapshot: AdminReportExportRow[];
};

const BRAND = {
  forest: [15, 61, 46] as const,
  green: [31, 107, 69] as const,
  accent: [47, 143, 87] as const,
  maroon: [139, 58, 70] as const,
  ink: [23, 37, 30] as const,
  muted: [102, 117, 108] as const,
  line: [227, 232, 228] as const,
  soft: [234, 245, 238] as const,
  white: [255, 255, 255] as const,
};

function num(value: number | undefined | null, fallback = "—") {
  if (value == null || Number.isNaN(value)) return fallback;
  return value.toLocaleString("en-PH");
}

function pctLabel(delta: number | null | undefined) {
  if (delta == null || Number.isNaN(delta)) return null;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

export function buildAdminReportExportPayload(input: {
  rangeLabel: string;
  vsLabel: string;
  generatedAt?: Date;
  uploaded?: number;
  uploadedPrev?: number;
  released?: number;
  releasedPrev?: number;
  downloads?: number;
  downloadsPrev?: number;
  denied?: number;
  deniedPrev?: number;
  activeUsers?: number;
  totalPatients?: number;
  totalResults?: number;
  totalPending?: number;
  totalReleased?: number;
  totalArchived?: number;
  uploadsToday?: number;
  totalStaffUsers?: number;
  totalPhysicians?: number;
  adminUsers?: number;
  inactiveUsers?: number;
  loginCount?: number;
  logoutCount?: number;
  health: "ok" | "down" | "checking";
  departments: Array<{ category?: string | null; count?: number | null }>;
  daily: Array<{ day: string; uploaded: number }>;
  topUploaders: Array<{ userName?: string | null; uploadCount?: number | null }>;
}): AdminReportExportPayload {
  const generatedAt = input.generatedAt ?? new Date();
  return {
    rangeLabel: input.rangeLabel,
    generatedAt,
    kpis: [
      { label: "New Patients", value: "Unavailable" },
      {
        label: "Results Uploaded",
        value: num(input.uploaded),
        delta: pctLabel(
          input.uploaded != null && input.uploadedPrev != null
            ? percentChange(input.uploaded, input.uploadedPrev)
            : null,
        ),
      },
      {
        label: "Results Released",
        value: num(input.released),
        delta: pctLabel(
          input.released != null && input.releasedPrev != null
            ? percentChange(input.released, input.releasedPrev)
            : null,
        ),
      },
      {
        label: "Results Downloaded",
        value: num(input.downloads),
        delta: pctLabel(
          input.downloads != null && input.downloadsPrev != null
            ? percentChange(input.downloads, input.downloadsPrev)
            : null,
        ),
      },
      { label: "Active Users", value: num(input.activeUsers) },
      {
        label: "Failed Logins / Access Denied",
        value: num(input.denied),
        delta: pctLabel(
          input.denied != null && input.deniedPrev != null
            ? percentChange(input.denied, input.deniedPrev)
            : null,
        ),
      },
    ],
    departments: input.departments.map((row) => ({
      label: formatDept(String(row.category ?? "other")),
      value: num(Number(row.count ?? 0)),
    })),
    dailyActivity: input.daily.map((row) => ({
      label: row.day,
      value: num(row.uploaded),
    })),
    topUploaders: input.topUploaders.map((row, index) => ({
      label: `${index + 1}. ${row.userName?.trim() || "Staff"}`,
      value: `${num(Number(row.uploadCount ?? 0))} uploads`,
    })),
    resultsSnapshot: [
      { label: "Total results", value: num(input.totalResults) },
      { label: "Pending", value: num(input.totalPending) },
      { label: "Released (all-time)", value: num(input.totalReleased) },
      { label: "Archived", value: num(input.totalArchived) },
      { label: "Uploaded in period", value: num(input.uploaded) },
      { label: "Released in period", value: num(input.released) },
      { label: "Uploaded today", value: num(input.uploadsToday) },
      { label: "Downloaded in period", value: num(input.downloads) },
    ],
    usersSnapshot: [
      { label: "Total patients", value: num(input.totalPatients) },
      { label: "Staff (non-physician)", value: num(input.totalStaffUsers) },
      { label: "Physicians", value: num(input.totalPhysicians) },
      { label: "Administrators", value: num(input.adminUsers) },
      { label: "Active users", value: num(input.activeUsers) },
      { label: "Inactive users", value: num(input.inactiveUsers) },
    ],
    securitySnapshot: [
      { label: "Successful logins", value: num(input.loginCount) },
      { label: "Logouts", value: num(input.logoutCount) },
      { label: "Access denied / failed logins", value: num(input.denied) },
      { label: "Result downloads", value: num(input.downloads) },
    ],
    systemSnapshot: [
      {
        label: "API / Database health",
        value:
          input.health === "ok"
            ? "Operational"
            : input.health === "down"
              ? "Critical"
              : "Checking",
      },
      { label: "Report period", value: input.rangeLabel },
      { label: "Comparison basis", value: input.vsLabel },
      { label: "Timezone", value: "Asia/Manila (GMT+8)" },
    ],
  };
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

async function loadLogoDataUrl() {
  const candidates = ["logo_ace.png", "ACE-NOBG.png", "favicon_ace_logo.png"];
  for (const file of candidates) {
    try {
      const response = await fetch(publicAsset(file));
      if (!response.ok) continue;
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Failed to read logo"));
        reader.readAsDataURL(blob);
      });
      if (dataUrl.startsWith("data:image")) return dataUrl;
    } catch {
      // try next asset
    }
  }
  return null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function stampFilename(prefix: string, ext: string) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}.${ext}`;
}

export async function exportAdminReportsPdf(payload: AdminReportExportPayload) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = 36;

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - 48) return;
    doc.addPage();
    drawFooter(doc, pageWidth, pageHeight, margin);
    y = 48;
  };

  // Header band
  doc.setFillColor(...BRAND.forest);
  doc.rect(0, 0, pageWidth, 92, "F");
  doc.setFillColor(...BRAND.maroon);
  doc.rect(0, 92, pageWidth, 4, "F");

  const logo = await loadLogoDataUrl();
  if (logo) {
    try {
      doc.setFillColor(...BRAND.white);
      doc.roundedRect(margin, 18, 118, 56, 8, 8, "F");
      doc.addImage(logo, "PNG", margin + 8, 24, 102, 44, undefined, "FAST");
    } catch {
      // logo optional
    }
  }

  doc.setTextColor(...BRAND.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("ACE Medical Center Cebu", logo ? margin + 132 : margin, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Admin Control · Reports & Analytics", logo ? margin + 132 : margin, 58);
  doc.setFontSize(9);
  doc.text(`Period: ${payload.rangeLabel}`, logo ? margin + 132 : margin, 74);

  y = 118;
  doc.setTextColor(...BRAND.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Analytics Export Report", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND.muted);
  doc.text(`Generated ${formatManilaDateTime(payload.generatedAt)} · Asia/Manila (GMT+8)`, margin, y);
  y += 22;

  // KPI cards
  ensureSpace(96);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BRAND.forest);
  doc.text("Key performance indicators", margin, y);
  y += 12;

  const cardGap = 10;
  const cardW = (pageWidth - margin * 2 - cardGap * 2) / 3;
  const cardH = 58;
  payload.kpis.forEach((kpi, index) => {
    const col = index % 3;
    if (col === 0) ensureSpace(cardH + 12);
    const x = margin + col * (cardW + cardGap);
    const top = y;
    doc.setFillColor(...BRAND.soft);
    doc.setDrawColor(...BRAND.line);
    doc.roundedRect(x, top, cardW, cardH, 8, 8, "FD");
    doc.setTextColor(...BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(kpi.label.toUpperCase(), x + 10, top + 16);
    doc.setTextColor(...BRAND.forest);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(kpi.value, x + 10, top + 36);
    if (kpi.delta) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...BRAND.green);
      doc.text(kpi.delta, x + 10, top + 48);
    }
    if (col === 2 || index === payload.kpis.length - 1) y = top + cardH + 12;
  });

  const writeSection = (title: string, rows: AdminReportExportRow[], empty = "No data for this period") => {
    ensureSpace(40);
    doc.setFillColor(...BRAND.forest);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 22, 6, 6, "F");
    doc.setTextColor(...BRAND.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, margin + 12, y + 15);
    y += 30;

    if (rows.length === 0) {
      doc.setTextColor(...BRAND.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(empty, margin + 4, y);
      y += 18;
      return;
    }

    rows.forEach((row, index) => {
      ensureSpace(20);
      if (index % 2 === 0) {
        doc.setFillColor(248, 250, 248);
        doc.rect(margin, y - 11, pageWidth - margin * 2, 18, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...BRAND.ink);
      doc.text(row.label, margin + 8, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...BRAND.green);
      doc.text(row.value, pageWidth - margin - 8, y, { align: "right" });
      y += 18;
    });
    y += 10;
  };

  writeSection("Results by department", payload.departments);
  writeSection("Daily upload activity", payload.dailyActivity);
  writeSection("Most active uploaders", payload.topUploaders);
  writeSection("Results snapshot", payload.resultsSnapshot);
  writeSection("Users & patients snapshot", payload.usersSnapshot);
  writeSection("Security summary", payload.securitySnapshot);
  writeSection("System summary", payload.systemSnapshot);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    drawFooter(doc, pageWidth, pageHeight, margin, page, pageCount);
  }

  const blob = doc.output("blob");
  downloadBlob(blob, stampFilename("ACE-Reports-Analytics", "pdf"));
}

function drawFooter(
  doc: jsPDF,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  page = 1,
  pageCount = 1,
) {
  doc.setDrawColor(...BRAND.line);
  doc.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    "ACE Medical Center Cebu · Confidential analytics export · Not for patient chart use",
    margin,
    pageHeight - 22,
  );
  doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 22, { align: "right" });
}

export function exportAdminReportsCsv(payload: AdminReportExportPayload) {
  const lines: string[] = [];
  const push = (cells: string[]) => {
    lines.push(
      cells
        .map((cell) => {
          const value = String(cell ?? "");
          if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
          return value;
        })
        .join(","),
    );
  };

  push(["ACE Medical Center Cebu"]);
  push(["Reports & Analytics Export"]);
  push(["Period", payload.rangeLabel]);
  push(["Generated", formatManilaDateTime(payload.generatedAt)]);
  push([]);
  push(["Section", "Metric", "Value", "Change"]);
  payload.kpis.forEach((kpi) => push(["KPI", kpi.label, kpi.value, kpi.delta ?? ""]));
  const sections: AdminReportExportSection[] = [
    { title: "Departments", rows: payload.departments },
    { title: "Daily Activity", rows: payload.dailyActivity },
    { title: "Top Uploaders", rows: payload.topUploaders },
    { title: "Results Snapshot", rows: payload.resultsSnapshot },
    { title: "Users Snapshot", rows: payload.usersSnapshot },
    { title: "Security Snapshot", rows: payload.securitySnapshot },
    { title: "System Snapshot", rows: payload.systemSnapshot },
  ];
  sections.forEach((section) => {
    section.rows.forEach((row) => push([section.title, row.label, row.value, ""]));
  });

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, stampFilename("ACE-Reports-Analytics", "csv"));
}
