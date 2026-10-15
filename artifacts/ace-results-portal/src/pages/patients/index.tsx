import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  FilePlus2,
  FileText,
  Filter,
  MoreVertical,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { canCreatePatientsUi, canUploadResultFileUi, useDebouncedValue } from "@/lib/staff-permissions";
import {
  ageFromDob,
  avatarToneForName,
  fetchStaffPatientDirectorySummary,
  fetchStaffPatientList,
  patientDisplayName,
  patientInitials,
  type StaffPatientRow,
} from "@/lib/staff-patients-api";

type ResultsFilter = "all" | "with" | "without";
type PhysicianFilter = "all" | "with" | "without";

function formatDOB(dob: string) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatRegistered(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function physicianLabel(physicians: StaffPatientRow["assignedPhysicians"]) {
  if (!physicians?.length) return "—";
  if (physicians.length === 1) return physicians[0]!.name;
  return `${physicians[0]!.name} +${physicians.length - 1}`;
}

function formatCount(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function pageWindow(current: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }
  if (current >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", totalPages];
}

function SummaryCards({
  totalPatients,
  registeredThisMonth,
  withResults,
  loading,
  onFilterWithResults,
}: {
  totalPatients: number;
  registeredThisMonth: number;
  withResults: number;
  loading?: boolean;
  onFilterWithResults: () => void;
}) {
  const cards = [
    {
      key: "total",
      label: "Total Patients",
      value: totalPatients,
      hint: "All registered patients.",
      icon: Users,
      wrap: "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))]",
      onClick: undefined as undefined | (() => void),
    },
    {
      key: "month",
      label: "Registered This Month",
      value: registeredThisMonth,
      hint: "New patient registrations.",
      icon: FilePlus2,
      wrap: "bg-[hsl(var(--st-maroon-soft))] text-[hsl(var(--st-maroon))]",
      onClick: undefined as undefined | (() => void),
    },
    {
      key: "results",
      label: "With Results",
      value: withResults,
      hint: "Patients with diagnostic results.",
      icon: FileText,
      wrap: "bg-[hsl(210_60%_94%)] text-[hsl(210_55%_40%)]",
      onClick: onFilterWithResults,
    },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[6.5rem] animate-pulse rounded-[1.1rem] bg-[hsl(var(--st-green-soft))]" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        const Comp = card.onClick ? "button" : "div";
        return (
          <Comp
            key={card.key}
            type={card.onClick ? "button" : undefined}
            onClick={card.onClick}
            className={`st-card flex min-h-[6rem] items-center gap-3 rounded-[1.1rem] px-4 py-3.5 text-left sm:min-h-[6.5rem] sm:gap-4 sm:px-5 sm:py-4 ${
              card.onClick ? "cursor-pointer transition-colors hover:border-[hsl(var(--st-green))]/35" : ""
            }`}
          >
            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full sm:h-14 sm:w-14 ${card.wrap}`}>
              <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[hsl(var(--st-text))]">{card.label}</p>
              <p className="mt-1 text-3xl font-bold leading-none text-[hsl(var(--st-text))]">
                {formatCount(card.value)}
              </p>
              <p className="mt-1.5 text-xs st-muted">{card.hint}</p>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-[hsl(var(--st-muted))]" />
          </Comp>
        );
      })}
    </div>
  );
}

export default function PatientsPage() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const { auth } = useAuth();
  const canCreate = canCreatePatientsUi(auth.user?.role);
  const canUpload = canUploadResultFileUi(auth.user?.role, auth.user?.permissions);

  const [search, setSearch] = useState(() => new URLSearchParams(searchStr).get("search") ?? "");
  const debouncedSearch = useDebouncedValue(search, 350);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [resultsFilter, setResultsFilter] = useState<ResultsFilter>("all");
  const [physicianFilter, setPhysicianFilter] = useState<PhysicianFilter>("all");

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, resultsFilter, physicianFilter, pageSize]);

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    const next = debouncedSearch.trim();
    const current = params.get("search") ?? "";
    if (next === current) return;
    if (next) params.set("search", next);
    else params.delete("search");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/patients?${qs}` : "/patients");
  }, [debouncedSearch, searchStr]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        event.preventDefault();
        document.getElementById("staff-patients-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasResults =
    resultsFilter === "with" ? true : resultsFilter === "without" ? false : undefined;
  const hasPhysician =
    physicianFilter === "with" ? true : physicianFilter === "without" ? false : undefined;

  const listQuery = useQuery({
    queryKey: ["staff-patients-list", debouncedSearch, page, pageSize, resultsFilter, physicianFilter],
    queryFn: () =>
      fetchStaffPatientList({
        search: debouncedSearch || undefined,
        page,
        limit: pageSize,
        hasResults,
        hasPhysician,
      }),
  });

  const summaryQuery = useQuery({
    queryKey: ["staff-patients-summary"],
    queryFn: fetchStaffPatientDirectorySummary,
  });

  const patients = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(safePage * pageSize, total);
  const pages = useMemo(() => pageWindow(safePage, totalPages), [safePage, totalPages]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const activeFilterCount =
    (resultsFilter === "all" ? 0 : 1) + (physicianFilter === "all" ? 0 : 1);

  const openPatient = (id: number) => setLocation(`/patients/${id}`);

  return (
    <StaffLayout
      title="Patients"
      contextLine="Manage patient records and access codes"
      fill
      showSearch={false}
    >
      <div className="st-scroll flex h-full min-h-0 flex-col gap-5 overflow-y-auto pb-2">
        <SummaryCards
          totalPatients={summaryQuery.data?.totalPatients ?? 0}
          registeredThisMonth={summaryQuery.data?.registeredThisMonth ?? 0}
          withResults={summaryQuery.data?.withResults ?? 0}
          loading={summaryQuery.isLoading}
          onFilterWithResults={() => setResultsFilter("with")}
        />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--st-muted))]" />
            <input
              id="staff-patients-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by patient name, HIS ID, or email..."
              className="h-11 w-full rounded-xl border border-[hsl(var(--st-border))] bg-white pl-10 pr-16 text-sm text-[hsl(var(--st-text))] shadow-sm outline-none placeholder:text-[hsl(var(--st-muted))] focus-visible:border-[hsl(var(--st-green))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--st-green))]/20"
              aria-label="Search patients"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--st-muted))] sm:inline">
              Ctrl + K
            </kbd>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-[hsl(var(--st-border))] bg-white px-4 shadow-sm"
                >
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                  {activeFilterCount > 0 ? (
                    <span className="ml-2 rounded-full bg-[hsl(var(--st-green-soft))] px-1.5 text-[10px] font-bold text-[hsl(var(--st-green))]">
                      {activeFilterCount}
                    </span>
                  ) : null}
                  <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="staff-shell w-64">
                <DropdownMenuLabel>Results</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={resultsFilter}
                  onValueChange={(v) => setResultsFilter(v as ResultsFilter)}
                >
                  <DropdownMenuRadioItem value="all">All patients</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="with">With results</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="without">Without results</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Assigned physician</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={physicianFilter}
                  onValueChange={(v) => setPhysicianFilter(v as PhysicianFilter)}
                >
                  <DropdownMenuRadioItem value="all">Any assignment</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="with">Has physician</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="without">No physician</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                {activeFilterCount > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setResultsFilter("all");
                        setPhysicianFilter("all");
                      }}
                    >
                      Clear filters
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>

            {canCreate ? (
              <Button
                className="h-11 rounded-xl bg-[hsl(var(--st-green))] px-4 text-white hover:opacity-95"
                onClick={() => setLocation("/patients/new")}
              >
                <Plus className="mr-2 h-4 w-4" />
                New Patient
              </Button>
            ) : null}
          </div>
        </div>

        <div className="st-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
          {listQuery.isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-[hsl(var(--st-green-soft))]" />
              ))}
            </div>
          ) : listQuery.isError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
              <p className="text-sm font-semibold text-[hsl(var(--st-text))]">Could not load patients.</p>
              <Button variant="outline" onClick={() => void listQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : patients.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
              <p className="text-lg font-semibold text-[hsl(var(--st-text))]">No patients found</p>
              <p className="text-sm st-muted">
                {debouncedSearch || activeFilterCount > 0
                  ? "Try a different search or clear filters."
                  : "Register a new patient to get started."}
              </p>
              {canCreate && !debouncedSearch && activeFilterCount === 0 ? (
                <Button className="mt-2 bg-[hsl(var(--st-green))]" onClick={() => setLocation("/patients/new")}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Patient
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="st-scroll min-h-0 flex-1 overflow-auto">
                <table className="hidden w-full min-w-[68rem] table-fixed text-sm md:table">
                  <thead className="sticky top-0 z-[1] border-b border-[hsl(var(--st-border))] bg-white">
                    <tr>
                      <th className="w-[20%] px-4 py-3.5 text-left text-[13px] font-semibold text-[hsl(var(--st-muted))]">Patient</th>
                      <th className="w-[9%] px-4 py-3.5 text-left text-[13px] font-semibold text-[hsl(var(--st-muted))]">HIS ID</th>
                      <th className="w-[11%] px-4 py-3.5 text-left text-[13px] font-semibold text-[hsl(var(--st-muted))]">Date of Birth</th>
                      <th className="w-[16%] px-4 py-3.5 text-left text-[13px] font-semibold text-[hsl(var(--st-muted))]">Contact</th>
                      <th className="w-[14%] px-4 py-3.5 text-left text-[13px] font-semibold text-[hsl(var(--st-muted))]">Assigned Physician</th>
                      <th className="w-[10%] px-4 py-3.5 text-left text-[13px] font-semibold text-[hsl(var(--st-muted))]">Registered</th>
                      <th className="w-[8%] px-4 py-3.5 text-left text-[13px] font-semibold text-[hsl(var(--st-muted))]">Results</th>
                      <th className="w-[12%] px-4 py-3.5 text-right text-[13px] font-semibold text-[hsl(var(--st-muted))]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--st-border))]">
                    {patients.map((p) => {
                      const name = patientDisplayName(p);
                      const age = ageFromDob(p.dateOfBirth);
                      const initials = patientInitials(p);
                      const results = p.resultCount ?? 0;
                      return (
                        <tr
                          key={p.id}
                          className="cursor-pointer transition-colors hover:bg-[hsl(var(--st-cream))]/70"
                          onClick={() => openPatient(p.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarToneForName(name)}`}>
                                {initials}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-[hsl(var(--st-text))]">{name}</p>
                                {age != null ? (
                                  <p className="truncate text-xs st-muted">{age} yrs</p>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-sm font-semibold text-[hsl(var(--st-green))]">
                              {p.patientHisId}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-[hsl(var(--st-text))]">{formatDOB(p.dateOfBirth)}</p>
                            {age != null ? <p className="text-xs st-muted">{age} yrs</p> : null}
                          </td>
                          <td className="px-4 py-3">
                            {p.mobileNumber || p.email ? (
                              <div className="min-w-0">
                                <p className="truncate text-[hsl(var(--st-text))]">{p.mobileNumber || "—"}</p>
                                <p className="truncate text-xs st-muted">{p.email || "—"}</p>
                              </div>
                            ) : (
                              <span className="st-muted">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="truncate text-[hsl(var(--st-text))]">{physicianLabel(p.assignedPhysicians)}</p>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-[hsl(var(--st-text))]">
                            {formatRegistered(p.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ${
                                results > 0
                                  ? "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))]"
                                  : "bg-[hsl(var(--st-cream))] text-[hsl(var(--st-muted))]"
                              }`}
                            >
                              {results}
                            </span>
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-xl border-[hsl(var(--st-border))] bg-white"
                                onClick={() => openPatient(p.id)}
                              >
                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                                View
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 rounded-xl"
                                    aria-label={`More actions for ${name}`}
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="staff-shell">
                                  <DropdownMenuItem onClick={() => openPatient(p.id)}>
                                    Open patient record
                                  </DropdownMenuItem>
                                  {canUpload ? (
                                    <DropdownMenuItem onClick={() => setLocation(`/results/upload?patientId=${p.id}`)}>
                                      Upload result
                                    </DropdownMenuItem>
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

                <div className="divide-y divide-[hsl(var(--st-border))] md:hidden">
                  {patients.map((p) => {
                    const name = patientDisplayName(p);
                    const age = ageFromDob(p.dateOfBirth);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full items-start gap-3 p-4 text-left hover:bg-[hsl(var(--st-cream))]/70"
                        onClick={() => openPatient(p.id)}
                      >
                        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarToneForName(name)}`}>
                          {patientInitials(p)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[hsl(var(--st-text))]">{name}</p>
                          <p className="mt-0.5 font-mono text-xs font-semibold text-[hsl(var(--st-green))]">{p.patientHisId}</p>
                          <p className="mt-1 text-xs st-muted">
                            {formatDOB(p.dateOfBirth)}
                            {age != null ? ` · ${age} yrs` : ""}
                          </p>
                          <p className="mt-1 text-xs st-muted">{physicianLabel(p.assignedPhysicians)}</p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            (p.resultCount ?? 0) > 0
                              ? "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))]"
                              : "bg-[hsl(var(--st-cream))] text-[hsl(var(--st-muted))]"
                          }`}
                        >
                          {p.resultCount ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-[hsl(var(--st-border))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm st-muted">
                  Showing {rangeStart} – {rangeEnd} of {formatCount(total)} patients
                  {listQuery.isFetching ? " · Updating…" : ""}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm st-muted">
                    Rows per page
                    <select
                      className="h-9 rounded-xl border border-[hsl(var(--st-border))] bg-white px-2 text-sm text-[hsl(var(--st-text))]"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                    >
                      {[10, 20, 50].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      disabled={safePage <= 1}
                      onClick={() => setPage(1)}
                      aria-label="First page"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
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
                    {pages.map((item, idx) =>
                      item === "ellipsis" ? (
                        <span key={`e-${idx}`} className="px-1 text-sm st-muted">…</span>
                      ) : (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setPage(item)}
                          className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-semibold ${
                            item === safePage
                              ? "bg-[hsl(var(--st-green))] text-white"
                              : "text-[hsl(var(--st-text))] hover:bg-[hsl(var(--st-cream))]"
                          }`}
                          aria-current={item === safePage ? "page" : undefined}
                        >
                          {item}
                        </button>
                      ),
                    )}
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
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage(totalPages)}
                      aria-label="Last page"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </StaffLayout>
  );
}
