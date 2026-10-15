import { useState, type ReactNode } from "react";
import { REPORT_RANGE_OPTIONS, type ReportsRangePreset } from "@/lib/admin-reports-range";
import { WidgetFrame } from "./shared";

const CATEGORIES = ["Patients", "Results", "Users", "Audit Logs", "Storage", "Security", "System Activity"] as const;
const DEPARTMENTS = ["", "laboratory", "radiology", "ultrasound", "ct_scan", "mri", "ecg", "echo_2d", "rehabilitation", "other"];
const ROLES = ["", "super_admin", "medical_records", "laboratory", "radiology", "physician"];
const STATUSES = ["", "pending", "released", "archived"];

export function ReportBuilder({
  rangePreset,
  onGenerateScreen,
  onExportPdf,
  onExportCsv,
}: {
  rangePreset: ReportsRangePreset;
  onGenerateScreen: (summary: string) => void;
  onExportPdf?: () => void | Promise<void>;
  onExportCsv?: () => void;
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Results");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [output, setOutput] = useState<"screen" | "csv" | "pdf">("screen");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setCategory("Results");
    setDepartment("");
    setRole("");
    setStatus("");
    setOutput("screen");
    setMessage(null);
  }

  async function generate() {
    const summary = `${category} · ${REPORT_RANGE_OPTIONS.find((item) => item.id === rangePreset)?.label ?? "Selected range"}${department ? ` · ${department}` : ""}${status ? ` · ${status}` : ""}${role ? ` · ${role}` : ""}`;
    if (output === "screen") {
      onGenerateScreen(summary);
      setMessage("On-screen summary uses live counts already loaded for this session.");
      return;
    }
    if (output === "pdf") {
      if (!onExportPdf) {
        setMessage("PDF export is unavailable on this page.");
        return;
      }
      setBusy(true);
      try {
        await onExportPdf();
        setMessage("PDF export downloaded with the current analytics snapshot.");
      } catch {
        setMessage("PDF export failed. Try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!onExportCsv) {
      setMessage("CSV export is unavailable on this page.");
      return;
    }
    try {
      onExportCsv();
      setMessage("CSV export downloaded with the current analytics snapshot.");
    } catch {
      setMessage("CSV export failed. Try again.");
    }
  }

  return (
    <WidgetFrame title="Custom reports">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Report category">
          <select value={category} onChange={(event) => setCategory(event.target.value as (typeof CATEGORIES)[number])} className={selectClass}>
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Date range">
          <select disabled className={selectClass} value={rangePreset}>
            {REPORT_RANGE_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <select value={department} onChange={(event) => setDepartment(event.target.value)} className={selectClass}>
            <option value="">All</option>
            {DEPARTMENTS.filter(Boolean).map((item) => (
              <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={selectClass}>
            <option value="">All</option>
            {STATUSES.filter(Boolean).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="User role">
          <select value={role} onChange={(event) => setRole(event.target.value)} className={selectClass}>
            <option value="">All</option>
            {ROLES.filter(Boolean).map((item) => (
              <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
            ))}
          </select>
        </Field>
        <Field label="Output">
          <select value={output} onChange={(event) => setOutput(event.target.value as "screen" | "csv" | "pdf")} className={selectClass}>
            <option value="screen">Screen</option>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="rounded-lg bg-[#0F3D2E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Generating…" : "Generate Report"}
        </button>
        <button type="button" onClick={reset} className="rounded-lg border border-[#E3E8E4] bg-white px-4 py-2 text-sm font-semibold text-[#0F3D2E]">
          Reset
        </button>
      </div>
      {message ? <p className="mt-3 text-[12px] text-[#66756C]">{message}</p> : null}
    </WidgetFrame>
  );
}

const selectClass = "mt-1 h-10 w-full rounded-md border border-[#E3E8E4] bg-white px-3 text-sm";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[12px] font-medium text-[#66756C]">
      {label}
      {children}
    </label>
  );
}
