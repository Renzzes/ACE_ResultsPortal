import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getGetAdminOverviewQueryKey, useGetAdminOverview } from "@workspace/api-client-react";
import { useAuthoritativeRole } from "@/lib/auth";
import { mayRequestAdminOverview } from "@/lib/workflow-stability";
import { AdminLayout } from "@/components/layout/admin-layout";
import {
  Activity,
  Archive,
  BarChart3,
  Check,
  FileText,
  HardDrive,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Stethoscope,
  UserPlus,
  Users,
} from "lucide-react";

const TABS = [
  { id: "uploaded", label: "Results Uploaded", key: "uploaded" as const },
  { id: "released", label: "Results Released", key: "released" as const },
  { id: "registrations", label: "Registrations", key: "registrations" as const },
  { id: "logins", label: "Logins", key: "logins" as const },
];

const STORAGE_COLORS = ["#2F8F57", "#8B3A46", "#B7791F", "#4A6FA5"];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function patientDisplayName(row: { firstName: string; lastName: string; middleName?: string | null }) {
  return [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ").trim();
}

function formatActionTitle(action: string, details?: string | null) {
  const label = action.replaceAll("_", " ").toUpperCase();
  if (details && details.length > 0 && details.length < 80 && !/hash|token|password|otp|secret/i.test(details)) {
    return details.replaceAll("_", " ");
  }
  return label;
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value.slice(5);
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatStorageLabel(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 GB";
  if (value < 0.001) return `${(value * 1024 * 1024).toFixed(0)} KB`;
  if (value < 1) return `${(value * 1024).toFixed(1)} MB`;
  return `${value.toFixed(2)} GB`;
}

function SkeletonCard() {
  return <div className="ad-card h-[88px] animate-pulse rounded-xl bg-[#EAF5EE]/70" />;
}

export default function AdminOverviewPage() {
  const role = useAuthoritativeRole();
  const { data, isLoading, isError, refetch, isFetching } = useGetAdminOverview({
    query: { queryKey: getGetAdminOverviewQueryKey(), enabled: mayRequestAdminOverview(role) },
  });
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("uploaded");

  const metrics = data?.metrics;
  const storage = data?.storage;

  const feed = useMemo(() => {
    const live = data?.activity ?? [];
    return live.map((item) => ({
      id: String(item.id),
      title: formatActionTitle(String(item.action), item.details),
      detail: [item.userName, item.patientHisId].filter(Boolean).join(" · ") || "System",
      actor: item.userName || "System",
      time: new Date(item.createdAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }),
    }));
  }, [data?.activity]);

  const chartData = useMemo(() => {
    const points = data?.systemOverview.points ?? [];
    return points.map((row) => ({
      day: formatDay(String(row.date)),
      uploaded: Number(row.uploaded ?? 0),
      released: Number(row.released ?? 0),
      registrations: Number(row.registrations ?? 0),
      logins: Number(row.logins ?? 0),
    }));
  }, [data?.systemOverview.points]);

  const storageSlices = useMemo(() => {
    if (!storage?.available) return [];
    const slices: { name: string; value: number; color: string }[] = [];
    if (storage.databaseDataUsedGB != null && storage.databaseDataUsedGB > 0) {
      slices.push({ name: "Database data", value: storage.databaseDataUsedGB, color: STORAGE_COLORS[0]! });
    }
    if (storage.logUsedGB != null && storage.logUsedGB > 0) {
      slices.push({ name: "Transaction log", value: storage.logUsedGB, color: STORAGE_COLORS[1]! });
    }
    const free =
      storage.databaseAllocatedGB != null
        ? Math.max(
            0,
            storage.databaseAllocatedGB - ((storage.databaseDataUsedGB ?? 0) + (storage.logUsedGB ?? 0)),
          )
        : 0;
    if (free > 0) {
      slices.push({ name: "Free allocated", value: free, color: "#D7E3DB" });
    }
    if (slices.length === 0 && storage.databaseAllocatedGB != null && storage.databaseAllocatedGB > 0) {
      slices.push({
        name: "Database allocated",
        value: storage.databaseAllocatedGB,
        color: STORAGE_COLORS[0]!,
      });
    }
    return slices;
  }, [storage]);

  const usedPct = storage?.databaseUsedPercent ?? null;
  const usedGb = (storage?.databaseDataUsedGB ?? 0) + (storage?.logUsedGB ?? 0);
  const allocated = storage?.databaseAllocatedGB ?? null;
  const usedLabel =
    allocated != null ? `${formatStorageLabel(usedGb)} / ${formatStorageLabel(allocated)}` : null;

  if (isError) {
    return (
      <AdminLayout title="Admin Dashboard">
        <div className="ad-card mx-auto max-w-lg rounded-xl p-6 text-center">
          <p className="text-base font-semibold text-[#8B3A46]">Unable to load dashboard data.</p>
          <p className="mt-2 text-sm text-[#66756C]">The Admin Overview API did not respond successfully.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 rounded-lg bg-[#0F3D2E] px-4 py-2 text-sm font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Admin Dashboard" fill>
      <div className="grid gap-3 max-xl:auto-rows-min xl:h-full xl:min-h-0 xl:grid-rows-[auto_minmax(0,1.15fr)_minmax(0,1fr)_auto] xl:gap-2.5 xl:overflow-hidden">
        {isLoading ? (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
            <KpiCard to="/admin/patients" icon={Users} label="Total Patients" value={metrics?.totalPatients ?? 0} hint="From portal patients" />
            <KpiCard to="/admin/staff" icon={Shield} label="Staff Accounts" value={metrics?.staffAccounts ?? 0} hint="Active non-physician users" />
            <KpiCard to="/admin/doctors" icon={Stethoscope} label="Doctor Accounts" value={metrics?.doctorAccounts ?? 0} hint="Active physicians" />
            <KpiCard to="/admin/results" icon={FileText} label="Total Results" value={metrics?.totalResults ?? 0} hint={`${metrics?.uploadsToday ?? 0} uploaded today`} />
            <KpiCard to="/admin/results" icon={Activity} label="Pending Release" value={metrics?.pendingRelease ?? 0} hint="Requires action" warn />
            <Link href="/admin/storage" className="ad-card rounded-xl p-3 no-underline">
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#66756C]">Storage</p>
                <HardDrive className="h-4 w-4 text-[#1F6B45]" />
              </div>
              {storage?.available && usedPct != null ? (
                <>
                  <p className="mt-1.5 text-xl font-bold tabular-nums text-[#0F3D2E]">{usedPct}%</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#EAF5EE]">
                    <div className="h-full rounded-full bg-[#2F8F57]" style={{ width: `${Math.min(100, Math.max(0, usedPct))}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-[#66756C]">{usedLabel ?? "ACE_ResultsPortal"}</p>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-sm font-semibold text-[#8B3A46]">Unavailable</p>
                  <p className="mt-1.5 text-[11px] text-[#66756C]">Storage information unavailable.</p>
                </>
              )}
            </Link>
          </div>
        )}

        <div className="grid min-h-0 gap-2.5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)]">
          <section className="ad-card flex min-h-0 flex-col overflow-hidden rounded-xl p-3">
            <Header title="System Activity Feed" to="/admin/history" />
            {isLoading ? (
              <p className="mt-4 text-sm text-[#66756C]">Loading activity…</p>
            ) : feed.length === 0 ? (
              <p className="mt-4 text-sm text-[#66756C]">No recent system activity</p>
            ) : (
              <ul className="ace-scroll mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
                {feed.map((item) => (
                  <li key={item.id} className="flex gap-3 border-b border-[#F0F3F0] pb-2 last:border-0 last:pb-0">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EAF5EE] text-[#1F6B45]">
                      <Activity className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold uppercase tracking-wide text-[#17251E]">{item.title}</p>
                      <p className="truncate text-[12px] text-[#66756C]">{item.detail}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-[#66756C]">{item.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ad-card flex min-h-0 flex-col overflow-hidden rounded-xl p-3">
            <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#0F3D2E]">System Overview</h2>
              <span className="rounded-full bg-[#EAF5EE] px-2.5 py-1 text-[11px] font-semibold text-[#1F6B45]">
                Last {data?.systemOverview.days ?? 7} days
              </span>
            </div>
            <div className="mb-2 flex shrink-0 flex-wrap gap-1">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                    tab === item.key ? "bg-[#0F3D2E] text-white" : "bg-[#F7F8F5] text-[#66756C]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="min-h-[180px] flex-1 xl:min-h-0">
              {isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-[#66756C]">Loading chart…</div>
              ) : !data?.systemOverview.hasData ? (
                <div className="flex h-full items-center justify-center text-sm text-[#66756C]">Not enough activity data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="adFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2F8F57" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#2F8F57" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#E3E8E4" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#66756C" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#66756C" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey={tab} stroke="#2F8F57" fill="url(#adFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-2 grid shrink-0 grid-cols-4 gap-2">
              <Mini label="Total Results" value={metrics?.totalResults ?? 0} loading={isLoading} />
              <Mini label="Released" value={metrics?.totalReleased ?? 0} loading={isLoading} />
              <Mini label="Pending" value={metrics?.pendingRelease ?? 0} warn loading={isLoading} />
              <Mini label="Archived" value={metrics?.totalArchived ?? 0} loading={isLoading} />
            </div>
          </section>
        </div>

        <div className="grid min-h-0 gap-2.5 lg:grid-cols-2 xl:grid-cols-4">
          <section className="ad-card flex min-h-0 flex-col overflow-hidden rounded-xl p-3">
            <Header title="Recent Registrations" to="/admin/patients" />
            {isLoading ? (
              <p className="mt-4 text-sm text-[#66756C]">Loading…</p>
            ) : (data?.recentRegistrations.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-[#66756C]">No registrations yet</p>
            ) : (
              <ul className="ace-scroll mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
                {data!.recentRegistrations.map((row) => {
                  const name = patientDisplayName(row);
                  return (
                    <li key={row.id}>
                      <Link
                        href={`/patients/${row.id}`}
                        className="flex items-center gap-3 rounded-lg px-1 py-1.5 no-underline hover:bg-[#EAF5EE]"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EAF5EE] text-[10px] font-bold text-[#1F6B45]">
                          {initials(name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[#17251E]">{name}</span>
                          <span className="block text-[11px] text-[#66756C]">{row.patientHisId}</span>
                        </span>
                        <span className="text-[10px] text-[#66756C]">
                          {new Date(row.createdAt).toLocaleDateString("en-PH", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="ad-card flex min-h-0 flex-col overflow-hidden rounded-xl p-3">
            <Header title="Pending Results Requiring Action" to="/admin/results" />
            {isLoading ? (
              <p className="mt-4 text-sm text-[#66756C]">Loading…</p>
            ) : (data?.pendingResults.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-[#66756C]">No pending results</p>
            ) : (
              <ul className="ace-scroll mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
                {data!.pendingResults.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-2 rounded-lg bg-[#F7F8F5] px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#17251E]">{row.originalFileName}</p>
                      <p className="text-[11px] capitalize text-[#66756C]">
                        {row.patientFirstName} {row.patientLastName} · {row.category.replaceAll("_", " ")}
                      </p>
                      <p className="text-[10px] text-[#8B3A46]">
                        Uploaded {new Date(row.uploadedAt).toLocaleString("en-PH")}
                      </p>
                    </div>
                    <Link
                      href="/admin/results"
                      className="shrink-0 rounded-md bg-[#0F3D2E] px-2.5 py-1 text-[11px] font-semibold text-white no-underline"
                    >
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ad-card flex min-h-0 flex-col overflow-hidden rounded-xl p-3">
            <Header title="Storage Usage" to="/admin/storage" />
            {isLoading ? (
              <p className="mt-4 text-sm text-[#66756C]">Loading storage…</p>
            ) : !storage?.available ? (
              <p className="mt-4 text-sm text-[#66756C]">Storage information unavailable.</p>
            ) : storageSlices.length === 0 ? (
              <div className="mt-3 space-y-1 text-[12px] text-[#66756C]">
                <p>Database: {storage.databaseName}</p>
                <p>Allocated: {storage.databaseAllocatedGB ?? "—"} GB</p>
                <p>Data used: {storage.databaseDataUsedGB ?? "—"} GB</p>
                <p>Log used: {storage.logUsedGB ?? "—"} GB</p>
              </div>
            ) : (
              <div className="mt-1 flex min-h-0 flex-1 items-center gap-3">
                <div className="h-24 w-24 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={storageSlices} dataKey="value" innerRadius={24} outerRadius={42} paddingAngle={3}>
                        {storageSlices.map((slice) => (
                          <Cell key={slice.name} fill={slice.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-1.5 text-[12px]">
                  {storageSlices.map((slice) => (
                    <li key={slice.name} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: slice.color }} />
                      <span className="text-[#66756C]">
                        {slice.name} · {slice.value} GB
                      </span>
                    </li>
                  ))}
                  {usedLabel ? (
                    <li className="pt-1 font-semibold text-[#0F3D2E]">
                      {usedLabel}
                      <span className="mt-0.5 block text-[11px] font-medium text-[#66756C]">ACE_ResultsPortal allocated</span>
                    </li>
                  ) : null}
                </ul>
              </div>
            )}
          </section>

          <section className="ad-card flex min-h-0 flex-col overflow-hidden rounded-xl p-3">
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <h2 className="text-sm font-bold text-[#0F3D2E]">System Health</h2>
              <span
                className={`text-[11px] font-semibold ${
                  data?.systemHealth.overall === "degraded" ? "text-[#B42318]" : "text-[#1F6B45]"
                }`}
              >
                {isLoading
                  ? "Checking…"
                  : data?.systemHealth.overall === "degraded"
                    ? "Attention needed"
                    : "Checked systems OK"}
              </span>
            </div>
            <ul className="ace-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {(data?.systemHealth.items ?? []).map((item) => (
                <li key={item.id} className="flex items-center justify-between text-[13px]">
                  <span className="flex items-center gap-2 text-[#17251E]">
                    <Check
                      className={`h-3.5 w-3.5 ${
                        item.state === "Critical"
                          ? "text-[#B42318]"
                          : item.state === "Operational"
                            ? "text-[#2F8F57]"
                            : "text-[#66756C]"
                      }`}
                    />
                    {item.name}
                  </span>
                  <span className="text-[11px] text-[#66756C]">
                    {item.state} · {item.detail}
                  </span>
                </li>
              ))}
              {isLoading ? <li className="text-sm text-[#66756C]">Loading health…</li> : null}
            </ul>
          </section>
        </div>

        <div className="grid gap-2.5 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <section className="ad-card rounded-xl p-3">
            <Header title="Recent Messages" to="/admin/messages" />
            <p className="mt-3 text-sm text-[#66756C]">No messaging data available yet.</p>
          </section>

          <section className="ad-card rounded-xl p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#0F3D2E]">Quick Actions</h2>
              {isFetching && !isLoading ? (
                <span className="text-[11px] text-[#66756C]">Refreshing…</span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              <Action to="/patients/new" icon={UserPlus} label="Add Patient" />
              <Action to="/admin/staff" icon={Shield} label="Add Staff" />
              <Action to="/admin/doctors" icon={Stethoscope} label="Add Doctor" />
              <Action to="/admin/reports" icon={BarChart3} label="Reports" />
              <Action to="/admin/history" icon={Archive} label="Audit Logs" />
              <Action to="/admin/messages" icon={MessageSquare} label="Messages" />
              <Action to="/admin/settings" icon={Settings} label="Settings" />
            </div>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}

function Header({ title, to }: { title: string; to: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-bold text-[#0F3D2E]">{title}</h2>
      <Link href={to} className="text-[12px] font-semibold text-[#1F6B45] no-underline">
        View all →
      </Link>
    </div>
  );
}

function KpiCard({
  to,
  icon: Icon,
  label,
  value,
  hint,
  warn,
}: {
  to: string;
  icon: typeof Users;
  label: string;
  value: string | number;
  hint: string;
  warn?: boolean;
}) {
  return (
    <Link href={to} className="ad-card rounded-xl p-3 no-underline">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#66756C]">{label}</p>
        <Icon className={`h-4 w-4 ${warn ? "text-[#8B3A46]" : "text-[#1F6B45]"}`} />
      </div>
      <p className={`mt-1.5 text-xl font-bold tabular-nums ${warn ? "text-[#8B3A46]" : "text-[#0F3D2E]"}`}>{value}</p>
      <p className={`mt-1 text-[11px] font-medium ${warn ? "text-[#8B3A46]" : "text-[#1F6B45]"}`}>{hint}</p>
    </Link>
  );
}

function Mini({
  label,
  value,
  warn,
  loading,
}: {
  label: string;
  value: number;
  warn?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg bg-[#F7F8F5] px-2 py-2">
      <p className="text-[10px] text-[#66756C]">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${warn ? "text-[#8B3A46]" : "text-[#0F3D2E]"}`}>
        {loading ? "—" : value}
      </p>
    </div>
  );
}

function Action({ to, icon: Icon, label }: { to: string; icon: typeof Plus; label: string }) {
  return (
    <Link
      href={to}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-[#E3E8E4] bg-[#F7F8F5] px-2 py-2 no-underline hover:border-[#2F8F57]/40 hover:bg-[#EAF5EE]"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#1F6B45] shadow-sm">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-center text-[11px] font-semibold text-[#17251E]">{label}</span>
    </Link>
  );
}
