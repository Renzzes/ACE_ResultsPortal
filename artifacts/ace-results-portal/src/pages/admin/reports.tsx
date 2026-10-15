import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDailyUploadsQueryKey,
  getGetDashboardStatsQueryKey,
  getGetUploadsByDepartmentQueryKey,
  getListAuditLogsQueryKey,
  getListResultsQueryKey,
  getListUsersQueryKey,
  useGetDailyUploads,
  useGetDashboardStats,
  useGetTopActiveUsers,
  useGetUploadsByDepartment,
  useListAuditLogs,
  useListResults,
  useListUsers,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { ActivityChart } from "@/components/admin/reports/activity-chart";
import { DepartmentChart } from "@/components/admin/reports/department-chart";
import { PatientDemographics } from "@/components/admin/reports/patient-demographics";
import { RecentReports } from "@/components/admin/reports/recent-reports";
import { ReportBuilder } from "@/components/admin/reports/report-builder";
import { ResultCategoriesTable } from "@/components/admin/reports/result-types-table";
import { SecuritySummary } from "@/components/admin/reports/security-summary";
import { AnalyticsKpiCard, REPORT_TABS, WidgetEmpty, WidgetError, WidgetFrame, WidgetSkeleton, type ReportTab } from "@/components/admin/reports/shared";
import { SystemPerformance } from "@/components/admin/reports/system-performance";
import {
  REPORT_RANGE_OPTIONS,
  buildReportsRange,
  formatDept,
  formatManilaDateTime,
  percentChange,
  toQueryDate,
  type ReportsRangePreset,
} from "@/lib/admin-reports-range";
import {
  buildAdminReportExportPayload,
  exportAdminReportsCsv,
  exportAdminReportsPdf,
} from "@/lib/admin-reports-export";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, RefreshCw } from "lucide-react";

export default function AdminReportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<ReportsRangePreset>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [tab, setTab] = useState<ReportTab>("overview");
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [health, setHealth] = useState<"ok" | "down" | "checking">("checking");
  const [screenReport, setScreenReport] = useState<string | null>(null);

  const range = useMemo(() => buildReportsRange(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const current = { dateFrom: toQueryDate(range.from), dateTo: toQueryDate(range.to), page: 1, limit: 1 };
  const previous = { dateFrom: toQueryDate(range.previousFrom), dateTo: toQueryDate(range.previousTo), page: 1, limit: 1 };

  const statsQuery = useGetDashboardStats();
  const dailyQuery = useGetDailyUploads();
  const deptQuery = useGetUploadsByDepartment();
  const topUsersQuery = useGetTopActiveUsers();

  const uploadedNow = useListResults(current);
  const uploadedPrev = useListResults(previous);
  const releasedNow = useListResults({ ...current, status: "released" });
  const releasedPrev = useListResults({ ...previous, status: "released" });
  const pendingAll = useListResults({ status: "pending", page: 1, limit: 1 });
  const archivedAll = useListResults({ status: "archived", page: 1, limit: 1 });
  const uploadedToday = useListResults({
    dateFrom: toQueryDate(buildReportsRange("today").from),
    dateTo: toQueryDate(buildReportsRange("today").to),
    page: 1,
    limit: 1,
  });

  const downloadsNow = useListAuditLogs({ ...current, action: "download" });
  const downloadsPrev = useListAuditLogs({ ...previous, action: "download" });
  const deniedNow = useListAuditLogs({ ...current, action: "access_denied" });
  const deniedPrev = useListAuditLogs({ ...previous, action: "access_denied" });
  const loginsNow = useListAuditLogs({ ...current, action: "login" });
  const logoutsNow = useListAuditLogs({ ...current, action: "logout" });
  const deniedFeed = useListAuditLogs({ ...current, action: "access_denied", limit: 6 });

  const activeUsers = useListUsers({ isActive: true, page: 1, limit: 1 });
  const inactiveUsers = useListUsers({ isActive: false, page: 1, limit: 1 });
  const adminUsers = useListUsers({ role: "super_admin", page: 1, limit: 1 });
  const recentUsers = useListUsers({ page: 1, limit: 8 });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/healthz")
      .then((response) => {
        if (!cancelled) setHealth(response.ok ? "ok" : "down");
      })
      .catch(() => {
        if (!cancelled) setHealth("down");
      });
    return () => {
      cancelled = true;
    };
  }, [updatedAt]);

  const stats = statsQuery.data;
  const departments = Array.isArray(deptQuery.data) ? deptQuery.data : [];
  const daily = useMemo(() => {
    const rows = Array.isArray(dailyQuery.data) ? dailyQuery.data : [];
    return rows
      .filter((row) => {
        const date = new Date(String(row.date));
        return date >= range.from && date <= range.to;
      })
      .map((row) => ({
        day: formatDay(String(row.date)),
        uploaded: Number(row.count ?? 0),
        raw: String(row.date),
      }));
  }, [dailyQuery.data, range.from, range.to]);

  const sparkUploads = daily.map((row) => row.uploaded);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetDailyUploadsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetUploadsByDepartmentQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListResultsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListAuditLogsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      statsQuery.refetch(),
      dailyQuery.refetch(),
      deptQuery.refetch(),
      uploadedNow.refetch(),
      releasedNow.refetch(),
      downloadsNow.refetch(),
      deniedNow.refetch(),
    ]);
    setUpdatedAt(new Date());
  }

  const uploaded = uploadedNow.data?.total;
  const released = releasedNow.data?.total;
  const downloads = downloadsNow.data?.total;
  const denied = deniedNow.data?.total;
  const active = activeUsers.data?.total;

  function buildExportPayload() {
    return buildAdminReportExportPayload({
      rangeLabel: range.label,
      vsLabel: range.vsLabel,
      generatedAt: updatedAt,
      uploaded,
      uploadedPrev: uploadedPrev.data?.total,
      released,
      releasedPrev: releasedPrev.data?.total,
      downloads,
      downloadsPrev: downloadsPrev.data?.total,
      denied,
      deniedPrev: deniedPrev.data?.total,
      activeUsers: active,
      totalPatients: stats?.totalPatients,
      totalResults: stats?.totalResults,
      totalPending: pendingAll.data?.total ?? stats?.totalPending,
      totalReleased: stats?.totalReleased,
      totalArchived: archivedAll.data?.total,
      uploadsToday: uploadedToday.data?.total ?? stats?.uploadsToday,
      totalStaffUsers: stats?.totalStaffUsers,
      totalPhysicians: stats?.totalPhysicians,
      adminUsers: adminUsers.data?.total,
      inactiveUsers: inactiveUsers.data?.total,
      loginCount: loginsNow.data?.total,
      logoutCount: logoutsNow.data?.total,
      health,
      departments,
      daily,
      topUploaders: Array.isArray(topUsersQuery.data) ? topUsersQuery.data.slice(0, 10) : [],
    });
  }

  async function handleExportPdf() {
    try {
      toast({ title: "Preparing PDF…", description: "Building your analytics report." });
      await exportAdminReportsPdf(buildExportPayload());
      toast({ title: "PDF downloaded", description: "ACE Reports & Analytics export is ready." });
    } catch (error) {
      toast({
        title: "PDF export failed",
        description: error instanceof Error ? error.message : "Unable to create the PDF report.",
        variant: "destructive",
      });
    }
  }

  function handleExportCsv() {
    try {
      exportAdminReportsCsv(buildExportPayload());
      toast({ title: "CSV downloaded", description: "ACE Reports & Analytics export is ready." });
    } catch (error) {
      toast({
        title: "CSV export failed",
        description: error instanceof Error ? error.message : "Unable to create the CSV report.",
        variant: "destructive",
      });
    }
  }

  return (
    <AdminLayout title="Reports & Analytics" subtitle="Analyze system activity, trends, and performance metrics">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] font-medium text-[#66756C]">
              Date range
              <select
                value={preset}
                onChange={(event) => setPreset(event.target.value as ReportsRangePreset)}
                className="mt-1 block h-10 min-w-[12rem] rounded-md border border-[#E3E8E4] bg-white px-3 text-sm text-[#17251E]"
              >
                {REPORT_RANGE_OPTIONS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            {preset === "custom" ? (
              <>
                <label className="text-[12px] text-[#66756C]">
                  From
                  <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 block h-10 rounded-md border border-[#E3E8E4] px-2 text-sm" />
                </label>
                <label className="text-[12px] text-[#66756C]">
                  To
                  <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 block h-10 rounded-md border border-[#E3E8E4] px-2 text-sm" />
                </label>
              </>
            ) : null}
            <p className="pb-2 text-[12px] text-[#66756C]">{range.label}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-3.5 py-2 text-sm font-semibold text-white">
                Export Report <ChevronDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="admin-shell">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void handleExportPdf();
                }}
              >
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  handleExportCsv();
                }}
              >
                CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
          <AnalyticsKpiCard label="New Patients" unavailable vsLabel={range.vsLabel} />
          <AnalyticsKpiCard
            label="Results Uploaded"
            value={uploaded}
            loading={uploadedNow.isLoading}
            delta={percentChange(uploaded ?? 0, uploadedPrev.data?.total ?? 0)}
            vsLabel={range.vsLabel}
            spark={sparkUploads}
          />
          <AnalyticsKpiCard
            label="Results Released"
            value={released}
            loading={releasedNow.isLoading}
            delta={percentChange(released ?? 0, releasedPrev.data?.total ?? 0)}
            vsLabel={range.vsLabel}
          />
          <AnalyticsKpiCard
            label="Results Downloaded"
            value={downloads}
            loading={downloadsNow.isLoading}
            delta={percentChange(downloads ?? 0, downloadsPrev.data?.total ?? 0)}
            vsLabel={range.vsLabel}
          />
          <AnalyticsKpiCard
            label="Active Users"
            value={active}
            loading={activeUsers.isLoading}
            delta={null}
            vsLabel={range.vsLabel}
          />
          <AnalyticsKpiCard
            label="Failed Logins"
            value={denied}
            loading={deniedNow.isLoading}
            delta={percentChange(denied ?? 0, deniedPrev.data?.total ?? 0)}
            vsLabel={range.vsLabel}
            warn
          />
        </div>

        <div className="ace-scroll flex gap-1 overflow-x-auto border-b border-[#E3E8E4] pb-px" role="tablist" aria-label="Analytics sections">
          {REPORT_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`shrink-0 border-b-2 px-3 py-2 text-[13px] font-semibold ${
                tab === item.id ? "border-[#0F3D2E] text-[#0F3D2E]" : "border-transparent text-[#66756C] hover:text-[#0F3D2E]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="grid gap-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]">
              <ActivityChart
                data={daily}
                loading={dailyQuery.isLoading}
                error={dailyQuery.isError}
                onRetry={() => void dailyQuery.refetch()}
                onChangeRange={() => setPreset("30d")}
              />
              <DepartmentChart
                rows={departments}
                loading={deptQuery.isLoading}
                error={deptQuery.isError}
                onRetry={() => void deptQuery.refetch()}
                onSelect={() => setTab("results")}
              />
            </div>
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ResultCategoriesTable
                rows={departments}
                loading={deptQuery.isLoading}
                error={deptQuery.isError}
                onRetry={() => void deptQuery.refetch()}
              />
              <WidgetFrame title="Most active uploaders">
                {topUsersQuery.isLoading ? (
                  <WidgetSkeleton />
                ) : topUsersQuery.isError ? (
                  <WidgetError onRetry={() => void topUsersQuery.refetch()} />
                ) : !Array.isArray(topUsersQuery.data) || topUsersQuery.data.length === 0 ? (
                  <WidgetEmpty title="No uploader activity" body="No staff uploads are recorded yet." />
                ) : (
                  <ol className="space-y-2">
                    {topUsersQuery.data.slice(0, 6).map((row, index) => (
                      <li key={String(row.userId ?? index)} className="flex items-center justify-between text-sm">
                        <span className="font-medium text-[#17251E]">{index + 1}. {row.userName || "Staff"}</span>
                        <span className="tabular-nums text-[#66756C]">{row.uploadCount} uploads</span>
                      </li>
                    ))}
                  </ol>
                )}
              </WidgetFrame>
            </div>
            <div className="grid gap-3 xl:grid-cols-3">
              <PatientDemographics />
              <RecentReports onCreate={() => setTab("custom")} />
              <SystemPerformance health={health} onRetry={() => setUpdatedAt(new Date())} />
            </div>
          </div>
        ) : null}

        {tab === "patients" ? (
          <div className="grid gap-3 lg:grid-cols-3">
            <StatCard label="Total patients" value={stats?.totalPatients} loading={statsQuery.isLoading} />
            <StatCard label="New in selected period" unavailable />
            <StatCard label="Active portal accounts" unavailable />
            <div className="lg:col-span-3">
              <PatientDemographics />
            </div>
            <WidgetFrame title="Registration trend" className="lg:col-span-3">
              <WidgetEmpty
                title="Registration trend is not available"
                body="Patient created-at totals are not aggregated by day. Daily uploads are shown on Overview."
                action={
                  <button type="button" onClick={() => setTab("overview")} className="mt-3 text-[12px] font-semibold text-[#1F6B45]">
                    Open Overview
                  </button>
                }
              />
            </WidgetFrame>
          </div>
        ) : null}

        {tab === "results" ? (
          <div className="grid gap-3">
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Total results" value={stats?.totalResults} loading={statsQuery.isLoading} />
              <StatCard label="Pending" value={pendingAll.data?.total ?? stats?.totalPending} loading={pendingAll.isLoading} />
              <StatCard label="Released" value={stats?.totalReleased} loading={statsQuery.isLoading} />
              <StatCard label="Archived" value={archivedAll.data?.total} loading={archivedAll.isLoading} />
              <StatCard label="Uploaded in period" value={uploaded} loading={uploadedNow.isLoading} />
              <StatCard label="Released (uploaded in period)" value={released} loading={releasedNow.isLoading} />
              <StatCard label="Uploaded today" value={uploadedToday.data?.total ?? stats?.uploadsToday} loading={uploadedToday.isLoading} />
              <StatCard label="Downloaded in period" value={downloads} loading={downloadsNow.isLoading} />
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <DepartmentChart rows={departments} loading={deptQuery.isLoading} error={deptQuery.isError} onRetry={() => void deptQuery.refetch()} />
              <ActivityChart data={daily} loading={dailyQuery.isLoading} error={dailyQuery.isError} onRetry={() => void dailyQuery.refetch()} />
            </div>
          </div>
        ) : null}

        {tab === "users" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <StatCard label="Staff (non-physician)" value={stats?.totalStaffUsers} loading={statsQuery.isLoading} />
              <StatCard label="Physicians" value={stats?.totalPhysicians} loading={statsQuery.isLoading} />
              <StatCard label="Administrators" value={adminUsers.data?.total} loading={adminUsers.isLoading} />
              <StatCard label="Active users" value={active} loading={activeUsers.isLoading} />
              <StatCard label="Inactive users" value={inactiveUsers.data?.total} loading={inactiveUsers.isLoading} />
              <StatCard label="Failed / denied access" value={denied} loading={deniedNow.isLoading} />
            </div>
            <WidgetFrame title="Role distribution">
              {statsQuery.isLoading ? (
                <WidgetSkeleton />
              ) : (
                <RoleBars
                  admins={adminUsers.data?.total ?? 0}
                  doctors={stats?.totalPhysicians ?? 0}
                  staff={Math.max(0, (stats?.totalStaffUsers ?? 0) - (adminUsers.data?.total ?? 0))}
                />
              )}
            </WidgetFrame>
            <WidgetFrame title="Recently created users" className="lg:col-span-2">
              {recentUsers.isLoading ? (
                <WidgetSkeleton />
              ) : recentUsers.isError ? (
                <WidgetError onRetry={() => void recentUsers.refetch()} />
              ) : (recentUsers.data?.data ?? []).length === 0 ? (
                <WidgetEmpty />
              ) : (
                <ul className="space-y-2 text-sm">
                  {(recentUsers.data?.data ?? []).map((user) => (
                    <li key={user.id} className="flex justify-between gap-3">
                      <span className="font-medium text-[#17251E]">{user.firstName} {user.lastName}</span>
                      <span className="text-[12px] text-[#66756C]">{user.role.replaceAll("_", " ")} · {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("en-PH") : "No login recorded"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </WidgetFrame>
          </div>
        ) : null}

        {tab === "departments" ? (
          <WidgetFrame title="Department results">
            {deptQuery.isLoading ? (
              <WidgetSkeleton />
            ) : deptQuery.isError ? (
              <WidgetError onRetry={() => void deptQuery.refetch()} />
            ) : departments.length === 0 ? (
              <WidgetEmpty />
            ) : (
              <div className="ace-scroll overflow-auto">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-[#66756C]">
                    <tr>
                      {["Department", "Total results", "Uploaded", "Released", "Pending", "Downloads"].map((header) => (
                        <th key={header} className="px-3 py-2 font-semibold">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((row) => (
                      <tr key={row.category} className="border-t border-[#F0F3F0]">
                        <td className="px-3 py-2.5 font-medium text-[#17251E]">{formatDept(String(row.category))}</td>
                        <td className="px-3 py-2.5 tabular-nums">{Number(row.count).toLocaleString("en-PH")}</td>
                        <td className="px-3 py-2.5 text-[#66756C]">—</td>
                        <td className="px-3 py-2.5 text-[#66756C]">—</td>
                        <td className="px-3 py-2.5 text-[#66756C]">—</td>
                        <td className="px-3 py-2.5 text-[#66756C]">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-[#66756C]">Uploaded / released / pending / download splits by department are not returned by the current API. Totals are all-time category counts.</p>
              </div>
            )}
          </WidgetFrame>
        ) : null}

        {tab === "system" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <WidgetFrame title="Service health">
              <ul className="space-y-2 text-sm">
                <HealthRow name="API" state={health === "ok" ? "Operational" : health === "down" ? "Critical" : "Checking"} />
                <HealthRow name="Database" state={health === "ok" ? "Operational" : health === "down" ? "Critical" : "Checking"} />
                <HealthRow name="Authentication" state={health === "ok" ? "Operational" : "Unavailable"} />
                <HealthRow name="Storage" state="See Storage page" muted />
                <HealthRow name="File downloads" state={typeof downloads === "number" ? `${downloads.toLocaleString("en-PH")} in period` : "—"} muted />
              </ul>
            </WidgetFrame>
            <SystemPerformance health={health} onRetry={() => setUpdatedAt(new Date())} />
          </div>
        ) : null}

        {tab === "security" ? (
          <SecuritySummary
            loading={loginsNow.isLoading || deniedNow.isLoading}
            error={loginsNow.isError || deniedNow.isError}
            onRetry={() => {
              void loginsNow.refetch();
              void deniedNow.refetch();
            }}
            loginCount={loginsNow.data?.total}
            logoutCount={logoutsNow.data?.total}
            deniedCount={denied}
            downloadCount={downloads}
            alerts={(deniedFeed.data?.data ?? []).map((item) => ({
              id: item.id,
              title: String(item.details || item.action).replaceAll("_", " "),
              body: item.userName ? `Actor: ${item.userName}` : "No user name recorded",
              time: new Date(item.createdAt).toLocaleString("en-PH"),
            }))}
          />
        ) : null}

        {tab === "custom" ? (
          <div className="space-y-3">
            <ReportBuilder
              rangePreset={preset}
              onGenerateScreen={setScreenReport}
              onExportPdf={handleExportPdf}
              onExportCsv={handleExportCsv}
            />
            {screenReport ? (
              <WidgetFrame title="On-screen summary">
                <p className="text-sm text-[#17251E]">{screenReport}</p>
                <dl className="mt-3 grid gap-2 sm:grid-cols-3 text-sm">
                  <div><dt className="text-[#66756C]">Patients</dt><dd className="font-semibold">{stats?.totalPatients ?? "—"}</dd></div>
                  <div><dt className="text-[#66756C]">Results in period</dt><dd className="font-semibold">{uploaded ?? "—"}</dd></div>
                  <div><dt className="text-[#66756C]">Access denied</dt><dd className="font-semibold">{denied ?? "—"}</dd></div>
                </dl>
              </WidgetFrame>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E3E8E4] pt-3 text-[12px] text-[#66756C]">
          <p>All times are in Asia/Manila timezone (GMT+8)</p>
          <div className="flex items-center gap-3">
            <p>Last updated: {formatManilaDateTime(updatedAt)}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E3E8E4] bg-white px-2.5 py-1 font-semibold text-[#0F3D2E]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh Data
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(5);
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function StatCard({
  label,
  value,
  loading,
  unavailable,
}: {
  label: string;
  value?: number;
  loading?: boolean;
  unavailable?: boolean;
}) {
  return (
    <section className="ad-card rounded-xl p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#66756C]">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-16 animate-pulse rounded bg-[#EAF5EE]" />
      ) : (
        <p className="mt-1 text-xl font-bold tabular-nums text-[#0F3D2E]">{unavailable || value === undefined ? "—" : value.toLocaleString("en-PH")}</p>
      )}
      {unavailable ? <p className="mt-1 text-[11px] text-[#66756C]">Data unavailable</p> : null}
    </section>
  );
}

function RoleBars({ staff, doctors, admins }: { staff: number; doctors: number; admins: number }) {
  const max = Math.max(staff, doctors, admins, 1);
  const rows = [
    { label: "Staff", value: staff, color: "#2F8F57" },
    { label: "Doctors", value: doctors, color: "#1F6B45" },
    { label: "Administrators", value: admins, color: "#8B3A46" },
  ];
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span>{row.label}</span>
            <span className="tabular-nums text-[#66756C]">{row.value.toLocaleString("en-PH")}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#EAF5EE]">
            <div className="h-full rounded-full" style={{ width: `${(row.value / max) * 100}%`, background: row.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function HealthRow({ name, state, muted }: { name: string; state: string; muted?: boolean }) {
  return (
    <li className="flex items-center justify-between rounded-lg bg-[#F7F8F5] px-3 py-2">
      <span className="text-[#17251E]">{name}</span>
      <span className={`text-[12px] font-semibold ${muted ? "text-[#66756C]" : state === "Operational" ? "text-[#1F6B45]" : state === "Critical" ? "text-[#8B3A46]" : "text-[#B7791F]"}`}>
        {state}
      </span>
    </li>
  );
}
