import { Link } from "wouter";
import { Printer } from "lucide-react";
import type { Patient } from "@workspace/api-client-react";
import { PatientAvatar, ageFromDob } from "@/components/doctor/shared";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function printDoctorPatientDetails(patient: Patient) {
  const name = escapeHtml(`${patient.lastName}, ${patient.firstName}`);
  const age = ageFromDob(patient.dateOfBirth);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Patient details — ${name}</title>
  <style>
    @page { margin: 16mm; }
    body { font-family: Segoe UI, system-ui, sans-serif; color: #14261c; margin: 0; }
    .brand { letter-spacing: 0.18em; font-size: 11px; font-weight: 700; color: #9b3b4a; }
    h1 { font-size: 22px; margin: 6px 0 4px; }
    p.sub { margin: 0 0 18px; color: #5b6b62; font-size: 13px; }
    dl { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; font-size: 13px; }
    dt { color: #5b6b62; font-weight: 600; }
    dd { margin: 0; }
    .rule { height: 3px; width: 72px; background: #2f7a4a; margin: 10px 0 16px; }
  </style>
</head>
<body>
  <div class="brand">ACE MEDICAL CENTER — CEBU</div>
  <h1>Patient Details</h1>
  <p class="sub">Physician portal record</p>
  <div class="rule"></div>
  <dl>
    <dt>Patient</dt><dd>${name}</dd>
    <dt>Patient ID</dt><dd>${escapeHtml(patient.patientHisId)}</dd>
    <dt>Date of birth</dt><dd>${escapeHtml(new Date(patient.dateOfBirth).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }))}</dd>
    <dt>Age</dt><dd>${age != null ? String(age) : "—"}</dd>
    <dt>Contact</dt><dd>${escapeHtml(patient.mobileNumber ?? "—")}</dd>
    <dt>Email</dt><dd>${escapeHtml(patient.email ?? "—")}</dd>
    <dt>Released results</dt><dd>${String(patient.resultCount ?? 0)}</dd>
  </dl>
</body>
</html>`);
  doc.close();
  const cleanup = () => frame.remove();
  win.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    win.focus();
    win.print();
    window.setTimeout(cleanup, 1500);
  }, 200);
}

export function DoctorPatientsTable({
  patients = [],
  compact,
  title = "Patients",
  emptyLabel = "No assigned patients found.",
}: {
  patients?: Patient[];
  compact?: boolean;
  title?: string;
  emptyLabel?: string;
}) {
  return (
    <section className="doc-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl">
      <div className={`flex flex-shrink-0 flex-wrap items-center justify-between gap-2 ${compact ? "px-4 py-2.5" : "px-5 py-3"}`}>
        <h3 className={`font-semibold text-[hsl(var(--doc-text))] ${compact ? "text-sm" : ""}`}>{title}</h3>
      </div>
      <div className="doc-scroll min-h-0 flex-1 overflow-auto px-4 pb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide doc-muted">
              <th className="pb-2 pr-2 font-medium">Patient ID</th>
              <th className="pb-2 pr-2 font-medium">Date of birth</th>
              <th className="pb-2 pr-2 font-medium">Patient name</th>
              <th className="pb-2 pr-2 font-medium">Released</th>
              <th className="pb-2 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {patients.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm doc-muted">{emptyLabel}</td>
              </tr>
            ) : (
              patients.map((patient) => {
                const age = ageFromDob(patient.dateOfBirth);
                return (
                  <tr key={patient.id} className="border-t border-[hsl(var(--doc-border))]">
                    <td className="py-2 pr-2 font-mono text-xs text-[hsl(var(--doc-green))] whitespace-nowrap">
                      {patient.patientHisId}
                    </td>
                    <td className="py-2 pr-2 doc-muted whitespace-nowrap">
                      {new Date(patient.dateOfBirth).toLocaleDateString("en-PH")}
                      {age != null ? ` · ${age}y` : ""}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <PatientAvatar firstName={patient.firstName} lastName={patient.lastName} size="sm" />
                        <span className="truncate font-medium text-[hsl(var(--doc-text))]">
                          {patient.lastName}, {patient.firstName}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-2 doc-muted whitespace-nowrap">{patient.resultCount ?? 0}</td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/physician/patients/${patient.id}`}
                          className="text-xs font-semibold text-[hsl(var(--doc-green))] no-underline"
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          className="p-1 doc-muted"
                          aria-label={`Print details for ${patient.firstName} ${patient.lastName}`}
                          onClick={() => printDoctorPatientDetails(patient)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
