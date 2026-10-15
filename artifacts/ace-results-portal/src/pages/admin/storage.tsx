import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { getGetAdminOverviewQueryKey, useGetAdminOverview, type PortalStorageCompactSummary } from "@workspace/api-client-react";
import { useAuthoritativeRole } from "@/lib/auth";
import { mayRequestAdminOverview } from "@/lib/workflow-stability";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Archive,
  Check,
  Cloud,
  Database,
  Download,
  FileText,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CategoryId = "data" | "log" | "results";

type CategoryRowData = {
  id: CategoryId;
  name: string;
  description: string;
  sizeGb: number;
  pctOfAllocated: number;
  detail: string;
  color: string;
};

function formatGb(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 GB";
  if (value < 0.001) {
    const kb = value * 1024 * 1024;
    return `${kb.toLocaleString("en-PH", { maximumFractionDigits: 1 })} KB`;
  }
  if (value < 1) {
    const mb = value * 1024;
    return `${mb.toLocaleString("en-PH", { maximumFractionDigits: 1 })} MB`;
  }
  return `${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })} GB`;
}

function formatCount(value: number) {
  return value.toLocaleString("en-PH");
}

function usageTone(pct: number) {
  if (pct > 85) return { label: "Critical", color: "text-[#8B3A46]", icon: "bg-[#F8ECEF] text-[#8B3A46]" };
  if (pct >= 70) return { label: "Warning", color: "text-[#B7791F]", icon: "bg-[#F8EEDC] text-[#B7791F]" };
  return { label: "Normal", color: "text-[#1F6B45]", icon: "bg-[#EAF5EE] text-[#1F6B45]" };
}

function categoryIcon(id: CategoryId) {
  if (id === "log") return Database;
  if (id === "results") return FileText;
  return Database;
}

function buildCategories(storage: PortalStorageCompactSummary): CategoryRowData[] {
  const allocated = storage.databaseAllocatedGB ?? 0;
  const dataUsed = storage.databaseDataUsedGB ?? 0;
  const logUsed = storage.logUsedGB ?? 0;
  const resultFiles = storage.resultFilesGB ?? 0;
  const pct = (gb: number) => (allocated > 0 ? Number(((gb / allocated) * 100).toFixed(1)) : 0);

  return [
    {
      id: "data",
      name: "Database data",
      description: `ACE_ResultsPortal data files · allocated ${formatGb(storage.databaseDataAllocatedGB ?? 0)}`,
      sizeGb: dataUsed,
      pctOfAllocated: pct(dataUsed),
      detail: `Free in data files: ${formatGb(storage.databaseDataFreeGB ?? 0)}`,
      color: "#2F8F57",
    },
    {
      id: "log",
      name: "Transaction log",
      description: `Log file allocated ${formatGb(storage.logAllocatedGB ?? 0)}`,
      sizeGb: logUsed,
      pctOfAllocated: pct(logUsed),
      detail: "SQL Server transaction log usage",
      color: "#8B3A46",
    },
    {
      id: "results",
      name: "Result files",
      description: "Document sizes recorded in dbo.results (filesystem copies)",
      sizeGb: resultFiles,
      pctOfAllocated: 0,
      detail: `${formatCount(storage.resultFileCount ?? 0)} files · ${formatCount(storage.resultFilesBytes ?? 0)} bytes`,
      color: "#B7791F",
    },
  ];
}

export default function AdminStoragePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const role = useAuthoritativeRole();
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useGetAdminOverview({
    query: { queryKey: getGetAdminOverviewQueryKey(), enabled: mayRequestAdminOverview(role) },
  });
  const [details, setDetails] = useState<CategoryId | "alerts" | null>(null);

  const storage = data?.storage;
  const categories = useMemo(() => (storage?.available ? buildCategories(storage) : []), [storage]);
  const usedPct = storage?.databaseUsedPercent ?? 0;
  const allocated = storage?.databaseAllocatedGB ?? 0;
  const usedGb = (storage?.databaseDataUsedGB ?? 0) + (storage?.logUsedGB ?? 0);
  const availableGb = Math.max(0, allocated - usedGb);
  const tone = usageTone(usedPct);

  const donut = useMemo(() => {
    const slices = [
      { name: "Database data", value: storage?.databaseDataUsedGB ?? 0, color: "#2F8F57" },
      { name: "Transaction log", value: storage?.logUsedGB ?? 0, color: "#8B3A46" },
      { name: "Free allocated", value: Math.max(availableGb, 0), color: "#D7E3DB" },
    ].filter((slice) => slice.value > 0);
    if (slices.length === 0 && allocated > 0) {
      return [{ name: "Allocated", value: allocated, color: "#2F8F57" }];
    }
    return slices;
  }, [storage, availableGb, allocated]);

  function unavailable(title: string) {
    toast({
      title,
      description: "This action is not connected to a live storage operation yet.",
    });
  }

  if (isLoading) {
    return (
      <AdminLayout title="Storage Management" subtitle="ACE_ResultsPortal database capacity and result-file sizes">
        <StorageSkeleton />
      </AdminLayout>
    );
  }

  if (isError || !storage?.available) {
    return (
      <AdminLayout title="Storage Management" subtitle="ACE_ResultsPortal database capacity and result-file sizes">
        <section className="ad-card flex min-h-[20rem] flex-col items-center justify-center rounded-xl p-8 text-center">
          <TriangleAlert className="h-8 w-8 text-[#B7791F]" />
          <h2 className="mt-3 text-lg font-bold text-[#0F3D2E]">Storage information unavailable</h2>
          <p className="mt-1 max-w-md text-sm text-[#66756C]">
            {storage?.error ?? "The system could not retrieve ACE_ResultsPortal storage information."}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 rounded-lg bg-[#0F3D2E] px-4 py-2 text-sm font-semibold text-white"
          >
            Retry
          </button>
        </section>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Storage Management" subtitle="Live capacity for the ACE_ResultsPortal database">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[12px] text-[#66756C]">
            <span className="font-semibold text-[#0F3D2E]">{storage.databaseName}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-[#2F8F57]" />
            <span className="font-semibold text-[#1F6B45]">Live read-only audit</span>
          </p>
          <div className="flex items-center gap-2 text-[12px] text-[#66756C]">
            <span>
              Last updated:{" "}
              {dataUpdatedAt
                ? new Date(dataUpdatedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
                : "—"}
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E3E8E4] bg-white px-2.5 py-1 font-semibold text-[#0F3D2E]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.15fr)]">
          <section className="ad-card flex min-h-[22rem] flex-col rounded-xl p-4">
            <h2 className="text-sm font-bold text-[#0F3D2E]">Database Capacity Overview</h2>
            <p className="mt-1 text-[12px] text-[#66756C]">
              Values are the file sizes allocated to <span className="font-semibold">ACE_ResultsPortal</span>, not the full server disk.
            </p>
            <div className="mt-2 grid min-h-0 flex-1 items-center gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
              <div className="relative mx-auto h-40 w-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
                      {donut.map((slice) => (
                        <Cell key={slice.name} fill={slice.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-2xl font-bold leading-none text-[#0F3D2E]">{usedPct}%</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#66756C]">Used</p>
                </div>
              </div>
              <ul className="space-y-2.5">
                {donut.map((item) => (
                  <li key={item.name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
                      <span className="truncate font-medium text-[#17251E]">{item.name}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-[#0F3D2E]">{formatGb(item.value)}</span>
                      <span className="block text-[11px] text-[#66756C]">
                        {allocated > 0 ? `${((item.value / allocated) * 100).toFixed(1)}%` : "—"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 grid shrink-0 grid-cols-3 gap-2 border-t border-[#E3E8E4] pt-3">
              <SummaryStat label="Allocated (DB)" value={formatGb(allocated)} />
              <SummaryStat label="Used (DB)" value={formatGb(usedGb)} />
              <SummaryStat label="Free in allocation" value={formatGb(availableGb)} />
            </div>
          </section>

          <section className="ad-card flex min-h-[22rem] flex-col rounded-xl p-4">
            <h2 className="text-sm font-bold text-[#0F3D2E]">Host Volume (context)</h2>
            <p className="mt-1 text-[12px] text-[#66756C]">
              Disk hosting ACE_ResultsPortal files. Shown for context only — not database quota.
            </p>
            {storage.serverTotalGB != null ? (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <SummaryStat label="Server volume total" value={formatGb(storage.serverTotalGB)} />
                <SummaryStat label="Server volume used" value={formatGb(storage.serverUsedGB ?? 0)} />
                <SummaryStat label="Server volume free" value={formatGb(storage.serverFreeGB ?? 0)} />
                <SummaryStat label="Server used %" value={`${storage.serverUsedPercent ?? 0}%`} />
              </div>
            ) : (
              <p className="mt-8 text-sm text-[#66756C]">Server volume metrics unavailable (permission or DMV access).</p>
            )}
            <div className="mt-auto border-t border-[#E3E8E4] pt-3">
              <p className="text-[12px] text-[#66756C]">
                Historical storage trend is not stored yet. Current snapshot only — no fabricated growth chart.
              </p>
            </div>
          </section>
        </div>

        <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.7fr)]">
          <section className="ad-card flex min-h-0 flex-col overflow-hidden rounded-xl">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-sm font-bold text-[#0F3D2E]">Storage Breakdown</h2>
            </div>
            <div className="ace-scroll min-h-0 flex-1 overflow-auto">
              <table className="min-w-[720px] w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#F7F8F5] text-[11px] uppercase tracking-wide text-[#66756C]">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Category</th>
                    <th className="px-4 py-2 font-semibold">Size</th>
                    <th className="px-4 py-2 font-semibold">Of allocated DB</th>
                    <th className="px-4 py-2 font-semibold">Detail</th>
                    <th className="px-4 py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((row) => (
                    <tr key={row.id} className="border-t border-[#F0F3F0]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="flex h-9 w-9 items-center justify-center rounded-lg"
                            style={{ background: `${row.color}18`, color: row.color }}
                          >
                            {(() => {
                              const Icon = categoryIcon(row.id);
                              return <Icon className="h-4 w-4" />;
                            })()}
                          </span>
                          <span>
                            <span className="block font-semibold text-[#17251E]">{row.name}</span>
                            <span className="block text-[11px] text-[#66756C]">{row.description}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums text-[#0F3D2E]">{formatGb(row.sizeGb)}</td>
                      <td className="px-4 py-3">
                        {row.id === "results" ? (
                          <span className="text-[12px] text-[#66756C]">Outside DB allocation</span>
                        ) : (
                          <div className="flex min-w-[8rem] items-center gap-2">
                            <span className="w-12 tabular-nums text-[#17251E]">{row.pctOfAllocated}%</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EAF5EE]">
                              <span
                                className="block h-full rounded-full"
                                style={{ width: `${Math.min(100, row.pctOfAllocated)}%`, background: row.color }}
                              />
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-[#66756C]">{row.detail}</td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="rounded-md p-1 text-[#66756C] hover:bg-[#EAF5EE]"
                              aria-label={`${row.name} actions`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="admin-shell">
                            <DropdownMenuItem onSelect={() => setDetails(row.id)}>View Details</DropdownMenuItem>
                            {row.id === "results" ? (
                              <DropdownMenuItem onSelect={() => setLocation("/admin/storage/files")}>
                                View Files
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-[#E3E8E4] px-4 py-3">
              <Link
                href="/admin/storage/files"
                className="rounded-lg bg-[#0F3D2E] px-3.5 py-2 text-[12px] font-semibold text-white no-underline"
              >
                View Result Files
              </Link>
              <button
                type="button"
                onClick={() => unavailable("Export is not available yet")}
                className="rounded-lg border border-[#E3E8E4] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#0F3D2E]"
              >
                Export Report
              </button>
            </div>
          </section>

          <section className="ad-card flex min-h-0 flex-col overflow-hidden rounded-xl p-4">
            <h2 className="text-sm font-bold text-[#0F3D2E]">Storage Actions</h2>
            <ul className="ace-scroll mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
              <ActionRow
                icon={Trash2}
                title="Cleanup Temporary Files"
                body="Not implemented — no destructive actions from this console"
                action="Unavailable"
                onClick={() => unavailable("Temporary file cleanup is not implemented")}
              />
              <ActionRow
                icon={Sparkles}
                title="Optimize Database"
                body="Read-only console — optimize is not available here"
                action="Unavailable"
                onClick={() => unavailable("Database optimize is not available from this console")}
              />
              <ActionRow
                icon={Download}
                title="Download Storage Report"
                body="Export is not wired yet"
                action="Unavailable"
                onClick={() => unavailable("Storage report export is not available yet")}
              />
              <ActionRow
                icon={Cloud}
                title="Manage Backups"
                body="No backup inventory API yet"
                action="Unavailable"
                onClick={() => unavailable("Backup management is not connected yet")}
              />
              <ActionRow
                icon={Settings}
                title="Storage Settings"
                body="Configure display thresholds"
                action="Configure"
                onClick={() => setLocation("/admin/settings?section=Storage")}
              />
            </ul>
          </section>
        </div>

        <section className="ad-card shrink-0 rounded-xl p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-[#0F3D2E]">Storage Status</h2>
            <button type="button" onClick={() => setDetails("alerts")} className="text-[12px] font-semibold text-[#1F6B45]">
              View details →
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <AlertItem
              icon={Check}
              tone={tone.icon}
              title={`Database allocation: ${tone.label} (${usedPct}%)`}
              body={`${formatGb(usedGb)} used of ${formatGb(allocated)} allocated to ACE_ResultsPortal.`}
            />
            <AlertItem
              icon={Archive}
              tone="bg-[#E8F0F8] text-[#3D5A80]"
              title="No fake backup or system-file categories"
              body="Only measurable ACE_ResultsPortal allocation and result-file sizes are shown."
            />
          </div>
        </section>
      </div>

      <Dialog open={details !== null} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <DialogContent className="admin-shell max-w-md">
          {details === "data" ? (
            <>
              <DialogHeader>
                <DialogTitle>Database data files</DialogTitle>
                <DialogDescription>ACE_ResultsPortal ROWS files from sys.database_files.</DialogDescription>
              </DialogHeader>
              <ul className="space-y-1 text-sm text-[#17251E]">
                <li>Allocated: {formatGb(storage.databaseDataAllocatedGB ?? 0)}</li>
                <li>Used: {formatGb(storage.databaseDataUsedGB ?? 0)}</li>
                <li>Free in data files: {formatGb(storage.databaseDataFreeGB ?? 0)}</li>
              </ul>
            </>
          ) : null}
          {details === "log" ? (
            <>
              <DialogHeader>
                <DialogTitle>Transaction log</DialogTitle>
                <DialogDescription>From sys.database_files and sys.dm_db_log_space_usage.</DialogDescription>
              </DialogHeader>
              <ul className="space-y-1 text-sm text-[#17251E]">
                <li>Allocated: {formatGb(storage.logAllocatedGB ?? 0)}</li>
                <li>Used: {formatGb(storage.logUsedGB ?? 0)}</li>
              </ul>
            </>
          ) : null}
          {details === "results" ? (
            <>
              <DialogHeader>
                <DialogTitle>Result files</DialogTitle>
                <DialogDescription>SUM(file_size_bytes) and COUNT(*) from dbo.results.</DialogDescription>
              </DialogHeader>
              <p className="text-sm text-[#17251E]">
                {formatCount(storage.resultFileCount ?? 0)} files · {formatGb(storage.resultFilesGB ?? 0)} (
                {formatCount(storage.resultFilesBytes ?? 0)} bytes)
              </p>
              <Link href="/admin/storage/files" className="text-sm font-semibold text-[#1F6B45]">
                Open file list
              </Link>
            </>
          ) : null}
          {details === "alerts" ? (
            <>
              <DialogHeader>
                <DialogTitle>Capacity notes</DialogTitle>
                <DialogDescription>Read-only audit against ACE_ResultsPortal.</DialogDescription>
              </DialogHeader>
              <ul className="space-y-2 text-sm text-[#17251E]">
                <li>
                  Database used {usedPct}% of allocated capacity — {tone.label} (below 70% is Normal).
                </li>
                <li>No mock backup or temporary-file sizes are displayed.</li>
                <li>This console does not shrink, rebuild, or delete database files.</li>
              </ul>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function StorageSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="h-8 animate-pulse rounded-lg bg-[#E3E8E4]/80" />
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="ad-card h-64 animate-pulse rounded-xl p-4">
          <div className="h-4 w-40 rounded bg-[#E3E8E4]" />
          <div className="mx-auto mt-8 h-32 w-32 rounded-full bg-[#EAF5EE]" />
        </div>
        <div className="ad-card h-64 animate-pulse rounded-xl p-4">
          <div className="h-4 w-48 rounded bg-[#E3E8E4]" />
          <div className="mt-6 h-36 rounded bg-[#EAF5EE]" />
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-[#66756C]">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-[#0F3D2E]">{value}</p>
    </div>
  );
}

function ActionRow({
  icon: Icon,
  title,
  body,
  action,
  onClick,
}: {
  icon: typeof FileText;
  title: string;
  body: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg px-1 py-2">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF5EE] text-[#1F6B45]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#17251E]">{title}</span>
        <span className="block text-[12px] text-[#66756C]">{body}</span>
      </span>
      <button type="button" onClick={onClick} className="shrink-0 pt-1 text-[12px] font-semibold text-[#1F6B45]">
        {action}
      </button>
    </li>
  );
}

function AlertItem({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof Check;
  tone: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#17251E]">{title}</p>
        <p className="mt-0.5 text-[12px] text-[#66756C]">{body}</p>
      </div>
    </div>
  );
}
