import { useEffect, useMemo, useState, type ElementType } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useListPatients,
  getListPatientsQueryKey,
  useGetPatient,
  getGetPatientQueryKey,
  useListPatientResultsPhysician,
  getListPatientResultsPhysicianQueryKey,
  type Patient,
} from "@workspace/api-client-react";
import { DoctorLayout } from "@/components/layout/doctor-layout";
import { NotificationsMenu } from "@/components/doctor/notifications-menu";
import { PhysicianSettingsDialog } from "@/components/doctor/settings-dialog";
import { LiveClock } from "@/components/doctor/widgets";
import {
  PatientAvatar,
  ageFromDob,
  CATEGORY_LABELS,
  Skeleton,
} from "@/components/doctor/shared";
import { printDoctorPatientDetails } from "@/components/doctor/patients-table";
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
  PATIENT_SORT_OPTIONS,
  PATIENT_STATUS_OPTIONS,
  fetchDoctorPatientStats,
  filterPatientsByStatus,
  formatPatientDate,
  formatResultDateTime,
  patientDisplayName,
  patientStatusLabel,
  recentReleasedResults,
  sortPatients,
  type PatientPortalRow,
  type PatientSortKey,
  type PatientStatusFilter,
} from "@/lib/doctor-patients";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Mail,
  MoreHorizontal,
  Printer,
  Search,
  Settings,
  User,
  UserRound,
  Users,
} from "lucide-react";

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
  tone: "green" | "blue" | "red" | "neutral";
}) {
  const tones = {
    green: {
      wrap: "border-[hsl(var(--doc-green))]/20 bg-[hsl(var(--doc-green-soft))]/40",
      icon: "bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]",
    },
    blue: {
      wrap: "border-[hsl(var(--doc-blue))]/20 bg-[hsl(var(--doc-blue-soft))]",
      icon: "bg-[hsl(var(--doc-blue-soft))] text-[hsl(var(--doc-blue))]",
    },
    red: {
      wrap: "border-[hsl(var(--doc-maroon))]/20 bg-[hsl(var(--doc-maroon-soft))]",
      icon: "bg-[hsl(var(--doc-maroon-soft))] text-[hsl(var(--doc-maroon))]",
    },
    neutral: {
      wrap: "border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-elevated))]/70",
      icon: "bg-[hsl(var(--doc-elevated))] text-[hsl(var(--doc-muted))]",
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

function PortalStatusBadge({ patient }: { patient: PatientPortalRow }) {
  const active = patientStatusLabel(patient) === "Active";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        active
          ? "bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]"
          : "bg-[hsl(var(--doc-elevated))] text-[hsl(var(--doc-muted))]"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--doc-border))] py-2 last:border-0">
      <span className="text-xs font-medium doc-muted">{label}</span>
      <span className="max-w-[60%] text-right text-sm font-medium text-[hsl(var(--doc-text))] break-words">
        {value}
      </span>
    </div>
  );
}

export default function PhysicianPatientsPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PatientStatusFilter>("all");
  const [sortKey, setSortKey] = useState<PatientSortKey>("name_asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rowMenuId, setRowMenuId] = useState<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const raw = params.get("patientId") ?? params.get("id");
    if (!raw) return;
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) setSelectedId(id);
  }, [searchString]);

  const unreadMessagesQuery = useQuery({
    queryKey: ["message-unread-count"],
    queryFn: fetchMessageUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const messageUnread = unreadMessagesQuery.data?.count ?? 0;

  const statsQuery = useQuery({
    queryKey: ["doctor-patient-stats"],
    queryFn: fetchDoctorPatientStats,
    staleTime: 30_000,
  });

  const listParams = {
    page,
    limit: pageSize,
    search: debouncedSearch || undefined,
  };
  const patientsQuery = useListPatients(listParams, {
    query: { queryKey: getListPatientsQueryKey(listParams) },
  });

  const pageRows = useMemo(() => {
    const raw = (patientsQuery.data?.data ?? []) as PatientPortalRow[];
    return sortPatients(filterPatientsByStatus(raw, statusFilter), sortKey);
  }, [patientsQuery.data?.data, statusFilter, sortKey]);

  const total = patientsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const showingCount = pageRows.length;

  const selectedPatientQuery = useGetPatient(selectedId ?? 0, {
    query: {
      queryKey: getGetPatientQueryKey(selectedId ?? 0),
      enabled: selectedId != null && selectedId > 0,
    },
  });

  const resultsQuery = useListPatientResultsPhysician(selectedId ?? 0, {
    query: {
      queryKey: getListPatientResultsPhysicianQueryKey(selectedId ?? 0),
      enabled: selectedId != null && selectedId > 0 && selectedPatientQuery.isSuccess,
    },
  });

  const selectedPatient = selectedPatientQuery.data as (Patient & { portalActive?: boolean }) | undefined;
  const recentResults = useMemo(
    () => recentReleasedResults(Array.isArray(resultsQuery.data) ? resultsQuery.data : [], 5),
    [resultsQuery.data],
  );

  const kpiValue = (n: number | null | undefined, loading: boolean, unavailable = false) => {
    if (loading) return "…";
    if (unavailable || n == null) return "—";
    return String(n);
  };

  const stats = statsQuery.data;
  const statsLoading = statsQuery.isLoading;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, pageSize]);

  return (
    <DoctorLayout fill hideHeaderActions>
      <div className="flex h-auto min-h-0 flex-col gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] xl:h-full xl:overflow-hidden xl:pb-0">
        {/* Header */}
        <div className="flex flex-shrink-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-[hsl(var(--doc-heading))] sm:text-2xl lg:text-[1.65rem]">
              My Patients
            </h1>
            <p className="mt-0.5 text-xs doc-muted sm:text-sm">
              Patients assigned to you. View patient information and their released results.
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
            icon={Users}
            value={kpiValue(stats?.total ?? total, statsLoading && !patientsQuery.data)}
            label="My Patients"
            subtitle="Total patients assigned to you"
          />
          <KpiCard
            tone="blue"
            icon={FileText}
            value={kpiValue(stats?.withReleasedResults, statsLoading)}
            label="With Released Results"
            subtitle="Patients with released results"
          />
          <KpiCard
            tone="red"
            icon={CalendarDays}
            value={kpiValue(null, statsLoading, true)}
            label="With Upcoming Appointments"
            subtitle="Scheduled appointments"
          />
          <KpiCard
            tone="neutral"
            icon={UserRound}
            value={kpiValue(stats?.inactiveOther, statsLoading, stats?.inactiveOther == null && !statsLoading)}
            label="Inactive / Other"
            subtitle="No active portal account"
          />
        </div>
        {stats?.upcomingAppointments === "unavailable" ? (
          <p className="-mt-1 text-[11px] doc-muted">
            Upcoming appointment counts are unavailable until physician scheduling is connected.
          </p>
        ) : null}

        {/* Main workspace */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.68fr)_minmax(0,0.32fr)] xl:overflow-hidden">
          {/* Left: patient list */}
          <section className="doc-card flex min-h-[22rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:h-full">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                <Users className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-[hsl(var(--doc-text))]">My Patients</h2>
            </div>

            <div className="flex flex-shrink-0 flex-col gap-2 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4">
              <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--doc-muted))]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by patient name or HIS ID..."
                  className="h-10 w-full rounded-xl border border-[hsl(var(--doc-border))] bg-white pl-9 pr-3 text-sm outline-none focus:border-[hsl(var(--doc-green))]"
                  aria-label="Search patients"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as PatientStatusFilter)}
              >
                <SelectTrigger
                  className={`${docSelectTrigger} w-full sm:w-[11.5rem]`}
                  aria-label="Status filter"
                >
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[hsl(var(--doc-border))]">
                  {PATIENT_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="rounded-lg">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as PatientSortKey)}>
                <SelectTrigger
                  className={`${docSelectTrigger} w-full sm:w-[13.5rem]`}
                  aria-label="Sort patients"
                >
                  <SelectValue placeholder="Sort by Name (A–Z)" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[hsl(var(--doc-border))]">
                  {PATIENT_SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="rounded-lg">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="doc-scroll min-h-0 flex-1 overflow-auto">
              {patientsQuery.isLoading ? (
                <div className="space-y-2 px-4 py-4">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : patientsQuery.isError ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <p className="font-semibold text-[hsl(var(--doc-text))]">Unable to load your patients</p>
                  <p className="mt-1 text-sm doc-muted">Please try again.</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 rounded-xl"
                    onClick={() => void patientsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="sticky top-0 z-10 bg-[hsl(var(--doc-elevated))]">
                      <tr className="border-b border-[hsl(var(--doc-border))] text-left text-[11px] uppercase tracking-wide doc-muted">
                        <th className="px-4 py-2.5 font-semibold">HIS ID</th>
                        <th className="px-3 py-2.5 font-semibold">Patient Name</th>
                        <th className="px-3 py-2.5 font-semibold">Date of Birth</th>
                        <th className="px-3 py-2.5 font-semibold">Age / Sex</th>
                        <th className="px-3 py-2.5 font-semibold">Last Released</th>
                        <th className="px-3 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-16 text-center text-sm doc-muted">
                            {debouncedSearch || statusFilter !== "all"
                              ? "No patients match your search or filters."
                              : "No assigned patients found."}
                          </td>
                        </tr>
                      ) : (
                        pageRows.map((patient) => {
                          const age = ageFromDob(patient.dateOfBirth);
                          const selected = patient.id === selectedId;
                          return (
                            <tr
                              key={patient.id}
                              className={`border-b border-[hsl(var(--doc-border))] last:border-0 ${
                                selected
                                  ? "bg-[hsl(var(--doc-green-soft))]/60"
                                  : "hover:bg-[hsl(var(--doc-elevated))]/80"
                              }`}
                            >
                              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-[hsl(var(--doc-green))]">
                                {patient.patientHisId}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex min-w-0 items-center gap-2">
                                  <PatientAvatar
                                    firstName={patient.firstName}
                                    lastName={patient.lastName}
                                    size="sm"
                                  />
                                  <span className="truncate font-medium text-[hsl(var(--doc-text))]">
                                    {patientDisplayName(patient)}
                                  </span>
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 doc-muted">
                                {formatPatientDate(patient.dateOfBirth)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-[hsl(var(--doc-text))]">
                                {age != null ? `${age} / —` : "— / —"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 doc-muted">—</td>
                              <td className="px-3 py-3">
                                <PortalStatusBadge patient={patient} />
                              </td>
                              <td className="px-4 py-3">
                                <div className="relative flex items-center justify-end gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 rounded-lg"
                                    onClick={() => setSelectedId(patient.id)}
                                  >
                                    View
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    aria-label="More actions"
                                    onClick={() =>
                                      setRowMenuId((id) => (id === patient.id ? null : patient.id))
                                    }
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                  {rowMenuId === patient.id ? (
                                    <div className="absolute right-0 top-9 z-20 min-w-[10rem] rounded-xl border border-[hsl(var(--doc-border))] bg-white py-1 shadow-md">
                                      <button
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[hsl(var(--doc-elevated))]"
                                        onClick={() => {
                                          setSelectedId(patient.id);
                                          setRowMenuId(null);
                                          setLocation(`/physician/patients/${patient.id}`);
                                        }}
                                      >
                                        <User className="h-3.5 w-3.5" />
                                        Full record
                                      </button>
                                      <button
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[hsl(var(--doc-elevated))]"
                                        onClick={() => {
                                          printDoctorPatientDetails(patient);
                                          setRowMenuId(null);
                                        }}
                                      >
                                        <Printer className="h-3.5 w-3.5" />
                                        Print details
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                  {statusFilter !== "all" ? (
                    <p className="px-4 py-2 text-[11px] doc-muted">
                      Status filter applies to the current page of assigned patients.
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
              <p className="text-xs doc-muted">
                Showing {patientsQuery.isLoading ? "…" : showingCount} of{" "}
                {patientsQuery.isLoading ? "…" : total} patients
                {statusFilter !== "all" ? " (page, after filter)" : ""}
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
                <span className="min-w-[4.5rem] text-center text-xs font-semibold text-[hsl(var(--doc-text))]">
                  Page {page} of {totalPages}
                </span>
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
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => setPageSize(Number(v))}
                >
                  <SelectTrigger
                    className="h-8 w-[6.5rem] rounded-lg border-[hsl(var(--doc-border))] bg-white text-xs text-[hsl(var(--doc-text))] shadow-none focus:ring-[hsl(var(--doc-green))]/30"
                    aria-label="Rows per page"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-[hsl(var(--doc-border))]">
                    {[10, 20, 50].map((n) => (
                      <SelectItem key={n} value={String(n)} className="rounded-lg text-xs">
                        {n} / page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Right: patient details */}
          <aside className="doc-card flex min-h-[22rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:h-full">
            {!selectedId ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--doc-green-soft))]">
                  <User className="h-9 w-9 text-[hsl(var(--doc-green))]" />
                </div>
                <p className="font-semibold text-[hsl(var(--doc-text))]">Select a patient</p>
                <p className="mt-1 max-w-xs text-sm doc-muted">
                  Choose a patient from the list to view demographics, recent released results, and
                  appointment information.
                </p>
              </div>
            ) : selectedPatientQuery.isLoading ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-24" />
                <Skeleton className="h-32" />
              </div>
            ) : selectedPatientQuery.isError || !selectedPatient ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                <p className="font-semibold text-[hsl(var(--doc-text))]">Unable to load this patient</p>
                <p className="mt-1 max-w-xs text-sm doc-muted">
                  The patient may not be assigned to you, or the record could not be found.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 rounded-xl"
                  onClick={() => void selectedPatientQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="doc-scroll flex min-h-0 flex-1 flex-col overflow-auto">
                <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                      <User className="h-4 w-4" />
                    </span>
                    <h2 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Patient Details</h2>
                  </div>
                  <Link
                    href={`/physician/patients/${selectedPatient.id}`}
                    className="text-xs font-semibold text-[hsl(var(--doc-green))] no-underline hover:underline"
                  >
                    View Full Record
                  </Link>
                </div>

                <div className="space-y-4 px-3 py-4 sm:px-4">
                  <div className="flex items-center gap-3">
                    <PatientAvatar
                      firstName={selectedPatient.firstName}
                      lastName={selectedPatient.lastName}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold text-[hsl(var(--doc-text))]">
                        {patientDisplayName(selectedPatient)}
                      </p>
                      <p className="font-mono text-xs text-[hsl(var(--doc-green))]">
                        HIS ID: {selectedPatient.patientHisId}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-elevated))]/40 px-3 py-1">
                    <DetailRow label="Date of Birth" value={formatPatientDate(selectedPatient.dateOfBirth)} />
                    <DetailRow
                      label="Sex"
                      value="—"
                    />
                    <DetailRow
                      label="Contact Number"
                      value={selectedPatient.mobileNumber?.trim() || "—"}
                    />
                    <DetailRow label="Address" value="—" />
                  </div>

                  {/* Recent Results */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                          <FileText className="h-3.5 w-3.5" />
                        </span>
                        <h3 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Recent Results</h3>
                      </div>
                      <Link
                        href="/physician/results"
                        className="text-xs font-semibold text-[hsl(var(--doc-green))] no-underline hover:underline"
                      >
                        View all
                      </Link>
                    </div>
                    {resultsQuery.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-14" />
                        <Skeleton className="h-14" />
                      </div>
                    ) : resultsQuery.isError ? (
                      <div className="rounded-xl border border-[hsl(var(--doc-border))] px-3 py-4 text-center">
                        <p className="text-sm font-medium text-[hsl(var(--doc-text))]">Unable to load results</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-2 rounded-lg"
                          onClick={() => void resultsQuery.refetch()}
                        >
                          Retry
                        </Button>
                      </div>
                    ) : recentResults.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[hsl(var(--doc-border))] px-3 py-6 text-center">
                        <p className="text-sm font-medium text-[hsl(var(--doc-text))]">No released results</p>
                        <p className="mt-1 text-xs doc-muted">
                          Released results assigned for your review will appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {recentResults.map((result) => (
                          <button
                            key={result.id}
                            type="button"
                            onClick={() => setLocation(`/physician/patients/${selectedPatient.id}`)}
                            className="flex w-full items-start gap-3 rounded-xl border border-[hsl(var(--doc-border))] bg-white px-3 py-2.5 text-left transition hover:border-[hsl(var(--doc-green))]/40 hover:bg-[hsl(var(--doc-green-soft))]/30"
                          >
                            <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                              <FileText className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-[hsl(var(--doc-text))]">
                                {CATEGORY_LABELS[result.category] ?? result.category}
                              </span>
                              <span className="mt-0.5 block truncate text-xs doc-muted">
                                {result.originalFileName}
                              </span>
                              <span className="mt-0.5 block text-[11px] doc-muted">
                                {formatResultDateTime(result.dateReleased ?? result.uploadedAt)}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Upcoming Appointments */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                          <CalendarDays className="h-3.5 w-3.5" />
                        </span>
                        <h3 className="text-sm font-semibold text-[hsl(var(--doc-text))]">
                          Upcoming Appointments
                        </h3>
                      </div>
                      <Link
                        href="/physician/appointments"
                        className="text-xs font-semibold text-[hsl(var(--doc-green))] no-underline hover:underline"
                      >
                        View all
                      </Link>
                    </div>
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-[hsl(var(--doc-border))] px-4 py-8 text-center">
                      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--doc-elevated))]">
                        <CalendarDays className="h-7 w-7 text-[hsl(var(--doc-muted))]" />
                      </div>
                      <p className="text-sm font-semibold text-[hsl(var(--doc-text))]">
                        Appointment information unavailable
                      </p>
                      <p className="mt-1 max-w-[16rem] text-xs doc-muted">
                        Physician scheduling is not connected yet. This section will show upcoming
                        appointments once available.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      <PhysicianSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </DoctorLayout>
  );
}
