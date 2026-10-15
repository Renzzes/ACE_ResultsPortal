import { useEffect, useMemo, useState, type ElementType } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useListResults,
  getListResultsQueryKey,
  type Result,
} from "@workspace/api-client-react";
import { DoctorLayout } from "@/components/layout/doctor-layout";
import { NotificationsMenu } from "@/components/doctor/notifications-menu";
import { PhysicianSettingsDialog } from "@/components/doctor/settings-dialog";
import { LiveClock } from "@/components/doctor/widgets";
import {
  Skeleton,
  EmptyState,
  StatusBadge,
  CATEGORY_LABELS,
} from "@/components/doctor/shared";
import {
  DocumentPreviewPane,
  ResultPreviewSheet,
  toPreviewableResult,
  useSelectedResult,
  type ResultReviewState,
} from "@/components/doctor/document-preview";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchMessageUnreadCount } from "@/lib/comms-api";
import {
  fetchDoctorResultStats,
  resultInDateBucket,
} from "@/lib/doctor-results";
import { isCompactViewport } from "@/lib/doctor-photo";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  FileText,
  Mail,
  MoreHorizontal,
  Search,
  Settings,
  XCircle,
} from "lucide-react";

const CATEGORIES = [
  "laboratory",
  "radiology",
  "ultrasound",
  "ct_scan",
  "mri",
  "ecg",
  "echo_2d",
  "rehabilitation",
  "other",
] as const;

const docSelectTrigger =
  "h-10 rounded-xl border-[hsl(var(--doc-border))] bg-white text-[hsl(var(--doc-text))] shadow-none focus:ring-[hsl(var(--doc-green))]/30";

function KpiCard({
  label,
  subtitle,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  subtitle: string;
  value: string;
  icon: ElementType;
  tone: "green" | "amber" | "red";
}) {
  const tones = {
    green: {
      wrap: "border-[hsl(var(--doc-green))]/25 bg-[hsl(var(--doc-green-soft))]/45",
      icon: "bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]",
    },
    amber: {
      wrap: "border-amber-300/60 bg-amber-50",
      icon: "bg-amber-100 text-amber-700",
    },
    red: {
      wrap: "border-[hsl(var(--doc-maroon))]/25 bg-[hsl(var(--doc-maroon-soft))]",
      icon: "bg-[hsl(var(--doc-maroon-soft))] text-[hsl(var(--doc-maroon))]",
    },
  }[tone];

  return (
    <div className={`doc-card flex h-full items-center gap-3 rounded-2xl border px-3 py-3 sm:px-4 ${tones.wrap}`}>
      <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${tones.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tracking-tight text-[hsl(var(--doc-text))]">{value}</p>
        <p className="mt-1 text-sm font-semibold text-[hsl(var(--doc-text))]">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug doc-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function CategoryPill({ category }: { category: string }) {
  return (
    <span className="inline-flex rounded-full bg-[hsl(var(--doc-blue-soft))] px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--doc-blue))]">
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

function formatDateParts(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }),
  };
}

function truncateName(name: string, max = 28) {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

export default function PhysicianResultsPage() {
  const [, setLocation] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reviewOverrides, setReviewOverrides] = useState<Record<number, ResultReviewState>>({});
  const [rowMenuId, setRowMenuId] = useState<number | null>(null);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, category, statusFilter, dateFilter, pageSize]);

  const unreadMessagesQuery = useQuery({
    queryKey: ["message-unread-count"],
    queryFn: fetchMessageUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const messageUnread = unreadMessagesQuery.data?.count ?? 0;

  const statsQuery = useQuery({
    queryKey: ["doctor-result-stats"],
    queryFn: fetchDoctorResultStats,
    staleTime: 30_000,
  });

  // Server supports search + category for physicians; status is applied client-side
  // because the API intentionally does not status-filter physician lists.
  const listParams = {
    page,
    limit: pageSize,
    search: debouncedSearch || undefined,
    category: category === "all" ? undefined : category,
  } as const;

  const resultsQuery = useListResults(listParams as any, {
    query: { queryKey: getListResultsQueryKey(listParams as any) },
  });

  const pageRows = useMemo(() => {
    const raw = (resultsQuery.data?.data ?? []) as Result[];
    return raw.filter((row) => {
      if (statusFilter !== "all" && String(row.status ?? "released") !== statusFilter) return false;
      if (!resultInDateBucket(row.dateReleased ?? row.uploadedAt, dateFilter)) return false;
      return true;
    });
  }, [resultsQuery.data?.data, statusFilter, dateFilter]);

  const previewable = useMemo(
    () =>
      pageRows.map((row) => {
        const base = toPreviewableResult(row);
        const override = reviewOverrides[row.id];
        return override ? { ...base, myReview: override } : base;
      }),
    [pageRows, reviewOverrides],
  );

  const { selectedId, setSelectedId, selected } = useSelectedResult(previewable);
  const total = resultsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const showing = pageRows.length;
  const clientFilterActive = statusFilter !== "all" || dateFilter !== "all";

  const openResult = (id: number) => {
    setSelectedId(id);
    if (isCompactViewport()) setMobilePreviewOpen(true);
  };

  const kpiValue = (n: number | null | undefined, loading: boolean) => {
    if (loading) return "…";
    if (n == null) return "—";
    return String(n);
  };

  const stats = statsQuery.data;
  const statsLoading = statsQuery.isLoading;

  return (
    <DoctorLayout fill hideHeaderActions>
      <div className="flex h-auto min-h-0 flex-col gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] xl:h-full xl:overflow-hidden xl:pb-0">
        {/* Header */}
        <div className="flex flex-shrink-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-[hsl(var(--doc-heading))] sm:text-2xl lg:text-[1.65rem]">
              Patient Results
            </h1>
            <p className="mt-0.5 text-xs doc-muted sm:text-sm">
              View results for your assigned patients. Results are available as read-only copies or
              released for patient viewing.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative h-10 w-10 rounded-full"
              aria-label="Messages"
              onClick={() => setLocation("/physician/messages")}
            >
              <Mail className="h-5 w-5" />
              {messageUnread > 0 ? (
                <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--doc-maroon))] px-1 text-[9px] font-bold text-white">
                  {messageUnread > 99 ? "99+" : messageUnread}
                </span>
              ) : null}
            </Button>
            <NotificationsMenu />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-5 w-5" />
            </Button>
            <LiveClock />
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid flex-shrink-0 grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-3">
          <KpiCard
            tone="green"
            icon={FileText}
            value={kpiValue(stats?.total ?? total, statsLoading && !resultsQuery.data)}
            label="Total Results"
            subtitle="For your assigned patients"
          />
          <KpiCard
            tone="green"
            icon={Eye}
            value={kpiValue(stats?.released, statsLoading)}
            label="Released"
            subtitle="Visible to patients"
          />
          <KpiCard
            tone="amber"
            icon={Clock3}
            value={kpiValue(stats?.pendingReview, statsLoading)}
            label="Pending Review"
            subtitle="Awaiting your review"
          />
          <KpiCard
            tone="red"
            icon={XCircle}
            value={kpiValue(stats?.requiresAttention, statsLoading)}
            label="Requires Attention"
            subtitle="For follow-up (if applicable)"
          />
        </div>

        {/* Toolbar */}
        <div className="doc-card flex flex-shrink-0 flex-col gap-2 rounded-2xl px-3 py-3 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="relative min-w-0 flex-1 lg:min-w-[16rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--doc-muted))]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient name, HIS ID, or study description..."
              className="h-10 w-full rounded-xl border border-[hsl(var(--doc-border))] bg-white pl-9 pr-3 text-sm outline-none focus:border-[hsl(var(--doc-green))]"
              aria-label="Search results"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className={`${docSelectTrigger} w-full lg:w-[11rem]`} aria-label="Category filter">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-[hsl(var(--doc-border))]">
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABELS[c] ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className={`${docSelectTrigger} w-full lg:w-[10.5rem]`} aria-label="Status filter">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-[hsl(var(--doc-border))]">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="released">Released</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className={`${docSelectTrigger} w-full lg:w-[10.5rem]`} aria-label="Date filter">
              <CalendarDays className="mr-2 h-4 w-4 text-[hsl(var(--doc-muted))]" />
              <SelectValue placeholder="All Dates" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-[hsl(var(--doc-border))]">
              <SelectItem value="all">All Dates</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {clientFilterActive ? (
          <p className="-mt-1 text-[11px] doc-muted">
            Status and date filters apply to the current page of authorized results. Search and
            category use the server.
          </p>
        ) : null}

        {/* Workspace */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.47fr)_minmax(0,0.53fr)] xl:overflow-hidden">
          {/* Left list */}
          <section className="doc-card flex min-h-[20rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:h-full">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                <FileText className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Patient Results</h2>
            </div>

            <div className="doc-scroll min-h-0 flex-1 overflow-auto">
              {resultsQuery.isLoading ? (
                <div className="space-y-2 px-4 py-4">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              ) : resultsQuery.isError ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <p className="font-semibold text-[hsl(var(--doc-text))]">Unable to load results</p>
                  <p className="mt-1 text-sm doc-muted">Please try again.</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 rounded-xl"
                    onClick={() => void resultsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : previewable.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No results found"
                  description={
                    debouncedSearch || category !== "all" || clientFilterActive
                      ? "No results match your search or filters."
                      : "Results assigned to you for review, and released results for your assigned patients, will appear here."
                  }
                />
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 z-10 bg-[hsl(var(--doc-elevated))]">
                    <tr className="border-b border-[hsl(var(--doc-border))] text-left text-[11px] uppercase tracking-wide doc-muted">
                      <th className="px-3 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 font-semibold">Patient</th>
                      <th className="px-3 py-2.5 font-semibold">Study / Description</th>
                      <th className="px-3 py-2.5 font-semibold">Category</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewable.map((row, index) => {
                      const source = pageRows[index];
                      const active = row.id === selectedId;
                      const stamp = formatDateParts(row.uploadedAt);
                      const study =
                        row.title ??
                        `${CATEGORY_LABELS[row.category] ?? row.category} Result`;
                      const patientLabel = (row.patientName ?? "Patient").toUpperCase();
                      return (
                        <tr
                          key={row.id}
                          onClick={() => setSelectedId(row.id)}
                          className={`cursor-pointer border-b border-[hsl(var(--doc-border))] last:border-0 ${
                            active
                              ? "bg-[hsl(var(--doc-green-soft))]/55 shadow-[inset_3px_0_0_0_hsl(var(--doc-green))]"
                              : "hover:bg-[hsl(var(--doc-elevated))]/70"
                          }`}
                        >
                          <td className="whitespace-nowrap px-3 py-3">
                            <p className="font-medium text-[hsl(var(--doc-text))]">{stamp.date}</p>
                            <p className="text-[11px] doc-muted">{stamp.time}</p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-semibold uppercase tracking-tight text-[hsl(var(--doc-text))]">
                              {truncateName(patientLabel, 32)}
                            </p>
                            <p className="text-[11px] doc-muted">
                              <span className="font-mono text-[hsl(var(--doc-green))]">
                                {row.patientHisId ?? "—"}
                              </span>
                              {" · — yrs · —"}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-semibold text-[hsl(var(--doc-text))]">{study}</p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] doc-muted">
                              <span className="max-w-[10rem] truncate">{row.originalFileName}</span>
                              {row.fileType ? (
                                <span className="rounded bg-[hsl(var(--doc-elevated))] px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                  {row.fileType}
                                </span>
                              ) : null}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <CategoryPill category={row.category} />
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge status={row.status ?? "released"} />
                            {row.myReview?.reviewed ? (
                              <p className="mt-1 text-[10px] font-semibold text-[hsl(var(--doc-blue))]">
                                Commented
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            <div className="relative flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 rounded-lg"
                                onClick={() => openResult(row.id)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                aria-label="More actions"
                                onClick={() =>
                                  setRowMenuId((id) => (id === row.id ? null : row.id))
                                }
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                              {rowMenuId === row.id ? (
                                <div className="absolute right-0 top-9 z-20 min-w-[9rem] rounded-xl border border-[hsl(var(--doc-border))] bg-white py-1 shadow-md">
                                  <button
                                    type="button"
                                    className="flex w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--doc-elevated))]"
                                    onClick={() => {
                                      openResult(row.id);
                                      setRowMenuId(null);
                                    }}
                                  >
                                    Open preview
                                  </button>
                                  {source?.patientId ? (
                                    <button
                                      type="button"
                                      className="flex w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--doc-elevated))]"
                                      onClick={() => {
                                        setLocation(`/physician/patients/${source.patientId}`);
                                        setRowMenuId(null);
                                      }}
                                    >
                                      Patient profile
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
              <p className="text-xs doc-muted">
                Showing {resultsQuery.isLoading ? "…" : showing} of{" "}
                {resultsQuery.isLoading ? "…" : total} result{total === 1 ? "" : "s"}
                {clientFilterActive ? " (page, after filter)" : ""}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  disabled={page <= 1}
                  aria-label="Previous page"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-[hsl(var(--doc-green))] px-2 text-xs font-bold text-white">
                  {page}
                </span>
                <span className="text-xs doc-muted">of {totalPages}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  disabled={page >= totalPages}
                  aria-label="Next page"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger
                    className="h-8 w-[6.5rem] rounded-lg border-[hsl(var(--doc-border))] bg-white text-xs shadow-none"
                    aria-label="Rows per page"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-[hsl(var(--doc-border))]">
                    {[10, 20, 50].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">
                        {n} / page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Right document + comment */}
          <section className="hidden min-h-0 xl:block xl:h-full">
            <DocumentPreviewPane
              variant="results"
              result={selected}
              patientName={selected?.patientName}
              localReview={selected ? reviewOverrides[selected.id] ?? null : null}
              onReviewSaved={(review) => {
                if (!selected) return;
                setReviewOverrides((prev) => ({ ...prev, [selected.id]: review }));
                void resultsQuery.refetch();
                void statsQuery.refetch();
              }}
            />
          </section>
        </div>
      </div>

      <ResultPreviewSheet
        open={mobilePreviewOpen}
        onOpenChange={setMobilePreviewOpen}
        result={selected}
        patientName={selected?.patientName}
        variant="results"
        onReviewSaved={(review) => {
          if (!selected) return;
          setReviewOverrides((prev) => ({ ...prev, [selected.id]: review }));
          void resultsQuery.refetch();
          void statsQuery.refetch();
        }}
      />

      <PhysicianSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </DoctorLayout>
  );
}
