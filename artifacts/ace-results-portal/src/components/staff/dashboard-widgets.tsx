import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Printer } from "lucide-react";
import type { StaffDeskOverview, StaffDeskPatient, StaffDeskResult } from "@/lib/staff-dashboard-api";

const STATUS_COLORS: Record<string, string> = {
  pending: "#8E3344",
  released: "#2A9B8F",
  archived: "#8A5A22",
};

const CATEGORY_COLORS = ["#2A9B8F", "#8E3344", "#C4A35A", "#44516A", "#4A6B2A", "#1F6F68", "#8A3B52", "#5B6B62", "#2F7A4A"];

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory",
  radiology: "Radiology",
  ultrasound: "Ultrasound",
  ct_scan: "CT Scan",
  mri: "MRI",
  ecg: "ECG",
  echo_2d: "Echo",
  rehabilitation: "Rehabilitation",
  other: "Other",
};

const AVATAR_TONES = [
  "bg-[#D8F0EC] text-[#1F6F68]",
  "bg-[#F8E3C4] text-[#8A5A22]",
  "bg-[#F3D6DE] text-[#8A3B52]",
  "bg-[#E4E9F2] text-[#44516A]",
  "bg-[#E4F2D8] text-[#4A6B2A]",
];

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function avatarTone(name: string) {
  const sum = name.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return AVATAR_TONES[sum % AVATAR_TONES.length];
}

function ageFromDob(dob?: string) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

function patientDisplayName(patient: StaffDeskPatient) {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, " ");
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function ChartCard({
  title,
  enter,
  empty,
  loading,
  children,
}: {
  title: string;
  enter?: string;
  empty?: string | null;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`st-card st-chart-in flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl px-4 py-3 ${enter ?? ""}`}>
      <h2 className="mb-1 flex-shrink-0 text-sm font-semibold text-[hsl(var(--st-text))]">{title}</h2>
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-24 w-full animate-pulse rounded-2xl bg-[hsl(var(--st-green-soft))]" />
          </div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center px-2 text-center text-sm st-muted">{empty}</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export function ResultActivityCard({
  data,
  loading,
}: {
  data: StaffDeskOverview["activity7d"];
  loading?: boolean;
}) {
  const hasData = data.some((row) => row.count > 0);
  return (
    <ChartCard
      title="Result Activity"
      enter="st-chart-in-1"
      loading={loading}
      empty={!loading && !hasData ? "No result activity yet." : null}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--st-border))" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--st-muted))" }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--st-muted))" }} />
          <Tooltip />
          <Bar dataKey="count" name="Uploads" fill="#2A9B8F" radius={[8, 8, 0, 0]} isAnimationActive animationDuration={900} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ResultStatusCard({
  data,
  loading,
}: {
  data: StaffDeskOverview["statusBreakdown"];
  loading?: boolean;
}) {
  const chartData = data.map((row) => ({
    name: statusLabel(row.status),
    value: row.count,
    color: STATUS_COLORS[row.status] ?? "#44516A",
  }));
  const total = chartData.reduce((sum, row) => sum + row.value, 0);

  return (
    <ChartCard
      title="Result Status"
      enter="st-chart-in-2"
      loading={loading}
      empty={!loading && total === 0 ? "No diagnostic results yet." : null}
    >
      <div className="relative h-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="value" innerRadius={38} outerRadius={56} paddingAngle={3} isAnimationActive animationDuration={1000}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value) => <span className="text-[11px] text-[hsl(var(--st-muted))]">{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center -translate-y-4">
          <div className="text-center">
            <p className="text-lg font-bold leading-none text-[hsl(var(--st-text))]">{total}</p>
            <p className="text-[10px] st-muted">Total</p>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

export function ResultCategoriesCard({
  data,
  loading,
}: {
  data: StaffDeskOverview["categoryBreakdown"];
  loading?: boolean;
}) {
  const chartData = data.map((row, index) => ({
    name: categoryLabel(row.category),
    value: row.count,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  }));
  const total = chartData.reduce((sum, row) => sum + row.value, 0);

  return (
    <ChartCard
      title="Result Categories"
      enter="st-chart-in-3"
      loading={loading}
      empty={!loading && total === 0 ? "No result category data yet." : null}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--st-border))" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--st-muted))" }} />
          <YAxis type="category" dataKey="name" width={78} tick={{ fontSize: 10, fill: "hsl(var(--st-muted))" }} />
          <Tooltip />
          <Bar dataKey="value" name="Results" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={900}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function printPatientDetails(patient: StaffDeskPatient) {
  const name = escapeHtml(patientDisplayName(patient));
  const hisId = escapeHtml(patient.patientHisId || "—");
  const age = ageFromDob(patient.dateOfBirth);
  const dob = patient.dateOfBirth
    ? escapeHtml(new Date(patient.dateOfBirth).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }))
    : "—";
  const registered = escapeHtml(
    new Date(patient.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }),
  );
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Patient — ${name}</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;color:#14261c;margin:24px}h1{font-size:20px}dt{color:#5b6b62;font-weight:600}dd{margin:0 0 8px}</style>
</head><body>
<h1>Patient Details</h1>
<dl>
<dt>Patient</dt><dd>${name}</dd>
<dt>HIS ID</dt><dd>${hisId}</dd>
<dt>Age</dt><dd>${age == null ? "—" : `${age} years`}</dd>
<dt>Date of birth</dt><dd>${dob}</dd>
<dt>Registered</dt><dd>${registered}</dd>
<dt>Results</dt><dd>${patient.resultCount}</dd>
</dl></body></html>`);
  doc.close();
  const cleanup = () => frame.remove();
  win.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    win.focus();
    win.print();
    window.setTimeout(cleanup, 1500);
  }, 200);
}

export function DeskPatientsCard({
  patients,
  loading,
}: {
  patients: StaffDeskPatient[];
  loading?: boolean;
}) {
  return (
    <section className="st-card st-chart-in st-chart-in-4 flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl px-4 py-3">
      <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[hsl(var(--st-text))]">Patients</h2>
        <Link href="/patients" className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline">
          View all
        </Link>
      </div>
      <div className="st-scroll min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-[hsl(var(--st-green-soft))]" />
            ))}
          </div>
        ) : patients.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm st-muted">No patients registered yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide st-muted">
                <th className="pb-2 pr-2 font-medium">Name</th>
                <th className="pb-2 pr-2 font-medium">Age</th>
                <th className="pb-2 pr-2 font-medium">HIS ID</th>
                <th className="pb-2 pr-2 font-medium">Registered</th>
                <th className="pb-2 pr-2 font-medium">Results</th>
                <th className="pb-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => {
                const name = patientDisplayName(patient);
                const age = ageFromDob(patient.dateOfBirth);
                return (
                  <tr key={patient.id} className="border-t border-[hsl(var(--st-border))]">
                    <td className="py-2 pr-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarTone(name)}`}>
                          {initials(name)}
                        </span>
                        <span className="truncate font-medium">{name}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-2 st-muted whitespace-nowrap">{age == null ? "—" : `${age} yrs`}</td>
                    <td className="py-2 pr-2 font-mono text-[11px] st-muted">{patient.patientHisId}</td>
                    <td className="py-2 pr-2 st-muted whitespace-nowrap">
                      {new Date(patient.createdAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">{patient.resultCount}</td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/patients/${patient.id}`} className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline">
                          View
                        </Link>
                        <button
                          type="button"
                          className="p-1 st-muted"
                          aria-label={`Print details for ${name}`}
                          onClick={() => printPatientDetails(patient)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function PendingActionsCard({
  pending,
  recentUploads,
  recentPatients,
  loading,
}: {
  pending: StaffDeskResult[];
  recentUploads: StaffDeskResult[];
  recentPatients: StaffDeskPatient[];
  loading?: boolean;
}) {
  return (
    <section className="st-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl px-4 py-4">
      <h2 className="flex-shrink-0 text-base font-semibold text-[hsl(var(--st-text))]">Pending Actions</h2>
      <div className="st-scroll mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-[hsl(var(--st-green-soft))]" />
            ))}
          </div>
        ) : (
          <>
            <ActionGroup title="Pending results" empty="No pending results.">
              {pending.map((item) => (
                <ActionRow
                  key={`p-${item.id}`}
                  href={`/results?status=pending`}
                  title={item.originalFileName || `Result #${item.id}`}
                  subtitle={`${item.patientName} · ${categoryLabel(item.category)}`}
                  meta={statusLabel(item.status)}
                />
              ))}
            </ActionGroup>
            <ActionGroup title="Recent uploads" empty="No uploads yet.">
              {recentUploads.slice(0, 5).map((item) => (
                <ActionRow
                  key={`u-${item.id}`}
                  href="/results"
                  title={item.originalFileName || `Result #${item.id}`}
                  subtitle={`${item.patientName} · ${categoryLabel(item.category)}`}
                  meta={new Date(item.uploadedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                />
              ))}
            </ActionGroup>
            <ActionGroup title="Recent registrations" empty="No patients registered yet.">
              {recentPatients.slice(0, 5).map((patient) => (
                <ActionRow
                  key={`reg-${patient.id}`}
                  href={`/patients/${patient.id}`}
                  title={patientDisplayName(patient)}
                  subtitle={patient.patientHisId}
                  meta={new Date(patient.createdAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}
                />
              ))}
            </ActionGroup>
          </>
        )}
      </div>
    </section>
  );
}

function ActionGroup({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide st-muted">{title}</p>
      {items.length === 0 ? (
        <p className="rounded-2xl bg-[hsl(var(--st-cream))] px-3 py-3 text-xs st-muted">{empty}</p>
      ) : (
        <ul className="space-y-1.5">{items}</ul>
      )}
    </div>
  );
}

function ActionRow({
  href,
  title,
  subtitle,
  meta,
}: {
  href: string;
  title: string;
  subtitle: string;
  meta: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-start gap-2 rounded-2xl bg-[hsl(var(--st-cream))] px-2.5 py-2.5 no-underline transition-colors hover:bg-[hsl(var(--st-green-soft))]"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[hsl(var(--st-text))]">{title}</p>
          <p className="truncate text-[11px] st-muted">{subtitle}</p>
        </div>
        <span className="flex-shrink-0 text-[10px] st-muted">{meta}</span>
      </Link>
    </li>
  );
}

export function RecentPatientsList({
  patients,
  loading,
}: {
  patients: StaffDeskPatient[];
  loading?: boolean;
}) {
  return (
    <section className="st-card flex min-h-0 flex-col overflow-hidden rounded-3xl px-4 py-3">
      <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[hsl(var(--st-text))]">Recent Patients</h2>
        <Link href="/patients" className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline">
          All patients
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-2xl bg-[hsl(var(--st-green-soft))]" />
          ))}
        </div>
      ) : patients.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm st-muted">No patients registered yet.</p>
      ) : (
        <ul className="st-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {patients.map((patient) => (
            <li key={patient.id}>
              <Link
                href={`/patients/${patient.id}`}
                className="flex items-start gap-3 rounded-2xl bg-[hsl(var(--st-cream))] px-3 py-2 no-underline"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[hsl(var(--st-text))]">{patientDisplayName(patient)}</p>
                  <p className="truncate text-xs st-muted">
                    {patient.patientHisId} · {patient.resultCount} result{patient.resultCount === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="flex-shrink-0 text-[10px] st-muted">
                  {new Date(patient.createdAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RecentResultsList({
  results,
  loading,
}: {
  results: StaffDeskResult[];
  loading?: boolean;
}) {
  return (
    <section className="st-card flex min-h-0 flex-col overflow-hidden rounded-3xl px-4 py-3">
      <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[hsl(var(--st-text))]">Recent Results</h2>
        <Link href="/results" className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline">
          All results
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-2xl bg-[hsl(var(--st-green-soft))]" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm st-muted">No diagnostic results yet.</p>
      ) : (
        <ul className="st-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {results.map((item) => (
            <li key={item.id}>
              <Link
                href="/results"
                className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--st-border))] px-3 py-2 no-underline"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[hsl(var(--st-text))]">
                    {item.originalFileName || `Result #${item.id}`}
                  </p>
                  <p className="truncate text-xs st-muted">
                    {item.patientName} · {categoryLabel(item.category)} · {statusLabel(item.status)}
                  </p>
                </div>
                <span className="flex-shrink-0 text-[10px] st-muted">
                  {new Date(item.uploadedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
