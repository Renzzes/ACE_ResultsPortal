import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  useListResults,
  getListResultsQueryKey,
  useUpdateResult,
  useReleaseResult,
  useDeleteResult,
  useGetDashboardStats,
  getGetDashboardStatsQueryKey,
  getListArchivedResultsQueryKey,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  canArchiveResultsUi,
  canDeleteResultsUi,
  canReleaseResultsUi,
  canUploadResultFileUi,
  categoriesForStaffRole,
  useDebouncedValue,
} from "@/lib/staff-permissions";
import {
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  FileText,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Unlock,
} from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory",
  radiology: "Radiology",
  ultrasound: "Ultrasound",
  ct_scan: "CT Scan",
  mri: "MRI",
  ecg: "ECG",
  echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation",
  other: "Other Diagnostics",
};

const CATEGORY_COLORS: Record<string, string> = {
  laboratory: "bg-blue-100 text-blue-800",
  radiology: "bg-purple-100 text-purple-800",
  ultrasound: "bg-teal-100 text-teal-800",
  ct_scan: "bg-indigo-100 text-indigo-800",
  mri: "bg-violet-100 text-violet-800",
  ecg: "bg-orange-100 text-orange-800",
  echo_2d: "bg-pink-100 text-pink-800",
  rehabilitation: "bg-green-100 text-green-800",
  other: "bg-gray-100 text-gray-800",
};

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  released: "bg-emerald-100 text-emerald-800",
  archived: "bg-slate-100 text-slate-600",
};

function formatBytes(bytes?: number | null) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fileTypeLabel(fileType?: string) {
  const t = (fileType ?? "").toLowerCase();
  if (t === "pdf") return "PDF";
  if (t === "jpeg" || t === "jpg") return "JPEG";
  if (t === "png") return "PNG";
  return t ? t.toUpperCase() : "FILE";
}

export default function ResultsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const role = auth.user?.role;
  const canArchive = canArchiveResultsUi(role);
  const canRelease = canReleaseResultsUi(role);
  const canDelete = canDeleteResultsUi(role);
  const canUpload = canUploadResultFileUi(role, auth.user?.permissions);
  const allowedCategories = useMemo(() => categoriesForStaffRole(role), [role]);

  const initialSearch = new URLSearchParams(searchStr).get("search") ?? "";
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [patientSearch, setPatientSearch] = useState(initialSearch);
  const debouncedSearch = useDebouncedValue(patientSearch, 350);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(searchStr).get("search");
    if (q) setPatientSearch(q);
  }, [searchStr]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [debouncedSearch, category, status, dateFrom, dateTo, pageSize]);

  const params = {
    page,
    limit: pageSize,
    ...(category ? { category: category as (typeof allowedCategories)[number] } : {}),
    ...(status ? { status: status as "pending" | "released" | "archived" } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
  };

  const { data, isLoading, isError, refetch } = useListResults(params, {
    query: { queryKey: getListResultsQueryKey(params) },
  });

  const { data: stats } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() },
  });

  const archiveResult = useUpdateResult();
  const releaseResult = useReleaseResult();
  const deleteResult = useDeleteResult();

  const results = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(safePage * pageSize, total);

  const pageIds = results.map((r) => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetFilters = () => {
    setCategory("");
    setStatus("");
    setDateFrom("");
    setDateTo("");
    setPatientSearch("");
    setPage(1);
  };

  const handleArchive = (id: number) => {
    archiveResult.mutate(
      { id, data: { status: "archived" } },
      {
        onSuccess: () => {
          toast({ title: "Result archived" });
          void refetch();
          void queryClient.invalidateQueries({ queryKey: getListArchivedResultsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
        },
        onError: () =>
          toast({ title: "You don't have permission to perform this action.", variant: "destructive" }),
      },
    );
  };

  const handleRelease = (id: number) => {
    releaseResult.mutate(
      { id, data: { releaseOption: "immediate" } },
      {
        onSuccess: () => {
          toast({ title: "Result released" });
          void refetch();
        },
        onError: () =>
          toast({ title: "You don't have permission to perform this action.", variant: "destructive" }),
      },
    );
  };

  const handleDelete = () => {
    if (deleteId == null) return;
    deleteResult.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          toast({ title: "Result deleted" });
          setDeleteId(null);
          void refetch();
        },
        onError: () =>
          toast({ title: "You don't have permission to perform this action.", variant: "destructive" }),
      },
    );
  };

  const openResult = (id: number) => setLocation(`/results/${id}`);

  const metricCards = [
    {
      key: "total",
      label: "Total Results",
      value: stats?.totalResults ?? 0,
      hint: "All uploaded results",
      icon: FileText,
      wrap: "bg-blue-100 text-blue-700",
    },
    {
      key: "pending",
      label: "Pending",
      value: stats?.totalPending ?? 0,
      hint: "Awaiting doctor review",
      icon: Clock3,
      wrap: "bg-[hsl(var(--st-maroon-soft))] text-[hsl(var(--st-maroon))]",
    },
    {
      key: "released",
      label: "Released",
      value: stats?.totalReleased ?? 0,
      hint: "Reviewed and released",
      icon: CheckCircle2,
      wrap: "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))]",
    },
    {
      key: "archived",
      label: "Archived",
      value: stats?.totalArchived ?? 0,
      hint: "Moved to archive",
      icon: Archive,
      wrap: "bg-slate-200 text-slate-700",
    },
  ];

  return (
    <StaffLayout
      title="Results"
      contextLine="Clinical results work queue. Click a row to preview the file."
      fill
      showSearch
    >
      <div className="st-scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto pb-2">
        <div className="flex justify-stretch sm:justify-end">
          {canUpload ? (
            <Button
              className="h-11 w-full rounded-xl bg-[hsl(var(--st-maroon))] px-4 text-white hover:opacity-95 sm:h-10 sm:w-auto"
              onClick={() => setLocation("/results/upload")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Upload Result
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {metricCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.key} className="st-card flex items-center gap-3 rounded-2xl px-3 py-3 sm:gap-4 sm:px-4 sm:py-4">
                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12 ${card.wrap}`}>
                  <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[hsl(var(--st-text))] sm:text-sm">{card.label}</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-[hsl(var(--st-text))] sm:text-2xl">
                    {typeof card.value === "number" ? card.value.toLocaleString("en-US") : card.value}
                  </p>
                  <p className="hidden text-xs st-muted sm:block">{card.hint}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-[hsl(var(--st-border))] bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full min-w-0 sm:min-w-[14rem] sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--st-muted))]" />
            <Input
              className="h-11 rounded-xl border-[hsl(var(--st-border))] pl-9 sm:h-10"
              placeholder="Search patient name or HIS ID..."
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              aria-label="Search results by patient"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:contents">
            <select
              className="h-11 w-full rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 text-sm text-[hsl(var(--st-text))] sm:h-10 sm:w-auto"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All Categories</option>
              {allowedCategories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <select
              className="h-11 w-full rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 text-sm text-[hsl(var(--st-text))] sm:h-10 sm:w-auto"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="released">Released</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:contents">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-11 w-full min-w-0 rounded-xl sm:h-10 sm:w-[9.5rem]"
              aria-label="Date from"
            />
            <span className="text-center text-sm st-muted">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-11 w-full min-w-0 rounded-xl sm:h-10 sm:w-[9.5rem]"
              aria-label="Date to"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-xl border-[hsl(var(--st-border))] bg-white sm:h-10 sm:w-auto"
            onClick={resetFilters}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset
          </Button>
        </div>

        <div className="st-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-[hsl(var(--st-green-soft))]" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
              <p className="font-semibold text-[hsl(var(--st-text))]">Could not load results.</p>
              <Button variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
              <p className="text-lg font-semibold text-[hsl(var(--st-text))]">No results found</p>
              <p className="text-sm st-muted">
                {category || status || dateFrom || dateTo || debouncedSearch
                  ? "No results match your filters."
                  : "Upload a diagnostic result to get started."}
              </p>
            </div>
          ) : (
            <>
              <div className="st-scroll min-h-0 flex-1 overflow-auto">
                {/* Mobile result cards */}
                <div className="divide-y divide-[hsl(var(--st-border))] md:hidden">
                  {results.map((r) => {
                    const size = formatBytes(r.fileSizeBytes);
                    const typeLabel = fileTypeLabel(r.fileType);
                    return (
                      <div
                        key={`m-${r.id}`}
                        className={`space-y-2 px-3 py-3 ${selectedIds.has(r.id) ? "bg-[hsl(var(--st-green-soft))]/40" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.id)}
                            onChange={() => toggleOne(r.id)}
                            aria-label={`Select ${r.originalFileName}`}
                            className="mt-1 h-4 w-4 rounded border-[hsl(var(--st-border))]"
                          />
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openResult(r.id)}>
                            <p className="truncate text-sm font-semibold text-[hsl(var(--st-text))]">
                              {r.originalFileName}
                            </p>
                            <p className="text-xs st-muted">
                              {typeLabel}
                              {size ? ` · ${size}` : ""}
                            </p>
                            <p className="mt-1 text-sm font-medium text-[hsl(var(--st-text))]">
                              {r.patientName || "—"}
                            </p>
                            <p className="font-mono text-xs text-[hsl(var(--st-green))]">{r.patientHisId || "—"}</p>
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pl-6">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              CATEGORY_COLORS[r.category] ?? "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {CATEGORY_LABELS[r.category] ?? r.category}
                          </span>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${
                              STATUS_CLASSES[r.status] ?? "bg-muted"
                            }`}
                          >
                            {r.status}
                          </span>
                          <span className="text-xs st-muted">{formatUploadedAt(r.uploadedAt)}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="ml-auto h-8 rounded-lg"
                            onClick={() => openResult(r.id)}
                          >
                            <Eye className="mr-1.5 h-3.5 w-3.5" />
                            View
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <table className="hidden w-full min-w-[68rem] text-sm md:table">
                  <thead className="sticky top-0 z-[1] border-b border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))]">
                    <tr>
                      <th className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={toggleAll}
                          aria-label="Select all results on this page"
                          className="h-4 w-4 rounded border-[hsl(var(--st-border))]"
                        />
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--st-muted))]">
                        Result File
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--st-muted))]">
                        Patient
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--st-muted))]">
                        Category
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--st-muted))]">
                        Status
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--st-muted))]">
                        Uploaded By
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--st-muted))]">
                        Date Uploaded
                      </th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--st-muted))]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--st-border))]">
                    {results.map((r) => {
                      const size = formatBytes(r.fileSizeBytes);
                      const typeLabel = fileTypeLabel(r.fileType);
                      return (
                        <tr
                          key={r.id}
                          className={`transition-colors hover:bg-[hsl(var(--st-cream))]/70 ${
                            selectedIds.has(r.id) ? "bg-[hsl(var(--st-green-soft))]/40" : ""
                          }`}
                        >
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleOne(r.id)}
                              aria-label={`Select ${r.originalFileName}`}
                              className="h-4 w-4 rounded border-[hsl(var(--st-border))]"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              className="flex min-w-0 max-w-[18rem] items-start gap-2 text-left"
                              onClick={() => openResult(r.id)}
                            >
                              <FileText
                                className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                                  (r.fileType ?? "").toLowerCase() === "pdf"
                                    ? "text-[hsl(var(--st-maroon))]"
                                    : "text-[hsl(var(--st-muted))]"
                                }`}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-[hsl(var(--st-text))]">
                                  {r.originalFileName}
                                </span>
                                <span className="block text-xs st-muted">
                                  {typeLabel}
                                  {size ? ` · ${size}` : ""}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-semibold text-[hsl(var(--st-text))]">{r.patientName || "—"}</p>
                            <p className="font-mono text-xs text-[hsl(var(--st-green))]">{r.patientHisId || "—"}</p>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                CATEGORY_COLORS[r.category] ?? "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {CATEGORY_LABELS[r.category] ?? r.category}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${
                                STATUS_CLASSES[r.status] ?? "bg-muted"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-[hsl(var(--st-text))]">{r.uploadedByName || "—"}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-[hsl(var(--st-text))]">
                            {formatUploadedAt(r.uploadedAt)}
                          </td>
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg border-[hsl(var(--st-border))] bg-white"
                                onClick={() => openResult(r.id)}
                              >
                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                                View
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 rounded-lg"
                                    aria-label={`More actions for ${r.originalFileName}`}
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="staff-shell">
                                  <DropdownMenuItem onClick={() => openResult(r.id)}>Open details</DropdownMenuItem>
                                  {canRelease && r.status === "pending" ? (
                                    <DropdownMenuItem onClick={() => handleRelease(r.id)}>
                                      <Unlock className="mr-2 h-3.5 w-3.5" />
                                      Release
                                    </DropdownMenuItem>
                                  ) : null}
                                  {canArchive && r.status !== "archived" ? (
                                    <DropdownMenuItem onClick={() => handleArchive(r.id)}>
                                      <Archive className="mr-2 h-3.5 w-3.5" />
                                      Archive
                                    </DropdownMenuItem>
                                  ) : null}
                                  {canDelete ? (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive"
                                        onClick={() => setDeleteId(r.id)}
                                      >
                                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                                        Delete
                                      </DropdownMenuItem>
                                    </>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-[hsl(var(--st-border))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm st-muted">
                  Showing {rangeStart} – {rangeEnd} of {total.toLocaleString("en-US")} results
                  {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm st-muted">
                    Rows per page
                    <select
                      className="h-9 rounded-xl border border-[hsl(var(--st-border))] bg-white px-2 text-sm"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                    >
                      {[10, 20, 50].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-[hsl(var(--st-green))] px-2 text-sm font-semibold text-white">
                      {safePage}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this result?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the result record and its stored file. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteResult.isPending}>
              {deleteResult.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StaffLayout>
  );
}
