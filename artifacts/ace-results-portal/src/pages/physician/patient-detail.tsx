import { useEffect, useMemo, useState, type ElementType } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetPatient,
  getGetPatientQueryKey,
  useListPatientResultsPhysician,
  getListPatientResultsPhysicianQueryKey,
  customFetch,
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
  PatientAvatar,
  ageFromDob,
  CATEGORY_LABELS,
} from "@/components/doctor/shared";
import {
  DocumentPreviewPane,
  ResultCommentDialog,
  ResultPreviewSheet,
  toPreviewableResult,
  useSelectedResult,
  type ResultReviewState,
} from "@/components/doctor/document-preview";
import { PhysicianPatientPrescriptions } from "@/components/doctor/patient-prescriptions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchMessageUnreadCount } from "@/lib/comms-api";
import { formatPatientDate, formatResultDateTime, patientDisplayName } from "@/lib/doctor-patients";
import { isCompactViewport } from "@/lib/doctor-photo";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  Eye,
  FileText,
  IdCard,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Search,
  Settings,
  Users,
} from "lucide-react";

type AssignedPhysicianRow = {
  id: number;
  name: string;
  username?: string;
  assignedAt?: string;
};

type ProfileTab = "overview" | "results" | "appointments" | "notes";

const TABS: Array<{
  id: ProfileTab;
  label: string;
  subtitle: string;
  icon: ElementType;
}> = [
  { id: "overview", label: "Overview", subtitle: "Patient information", icon: IdCard },
  { id: "results", label: "Results", subtitle: "View and comment results", icon: FileText },
  { id: "appointments", label: "Appointments", subtitle: "Schedule history", icon: CalendarDays },
  { id: "notes", label: "Notes", subtitle: "Your notes about this patient", icon: ClipboardList },
];

const docSelectTrigger =
  "h-10 rounded-xl border-[hsl(var(--doc-border))] bg-white text-[hsl(var(--doc-text))] shadow-none focus:ring-[hsl(var(--doc-green))]/30";

function matchesResultSearch(result: Result, q: string): boolean {
  if (!q) return true;
  const hay = [
    result.category,
    CATEGORY_LABELS[result.category],
    result.originalFileName,
    result.fileName,
    result.dateReleased,
    result.uploadedAt,
    formatResultDateTime(result.dateReleased ?? result.uploadedAt),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function inDateBucket(iso: string | null | undefined, bucket: string): boolean {
  if (bucket === "all") return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (bucket === "today") return d >= startToday;
  if (bucket === "7d") {
    const from = new Date(startToday);
    from.setDate(from.getDate() - 7);
    return d >= from;
  }
  if (bucket === "30d") {
    const from = new Date(startToday);
    from.setDate(from.getDate() - 30);
    return d >= from;
  }
  return true;
}

export default function PhysicianPatientDetail() {
  const [, params] = useRoute("/physician/patients/:id");
  const [, setLocation] = useLocation();
  const patientId = Number(params?.id);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<ProfileTab>("results");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [commentResultId, setCommentResultId] = useState<number | null>(null);
  const [reviewOverrides, setReviewOverrides] = useState<Record<number, ResultReviewState>>({});
  const [rowMenuId, setRowMenuId] = useState<number | null>(null);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  const unreadMessagesQuery = useQuery({
    queryKey: ["message-unread-count"],
    queryFn: fetchMessageUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const messageUnread = unreadMessagesQuery.data?.count ?? 0;

  const patientQuery = useGetPatient(patientId, {
    query: {
      queryKey: getGetPatientQueryKey(patientId),
      enabled: Number.isFinite(patientId) && patientId > 0,
    },
  });

  const resultsQuery = useListPatientResultsPhysician(patientId, {
    query: {
      queryKey: getListPatientResultsPhysicianQueryKey(patientId),
      enabled: Number.isFinite(patientId) && patientId > 0 && patientQuery.isSuccess,
    },
  });

  const physiciansQuery = useQuery({
    queryKey: ["physician-patient-physicians", patientId],
    queryFn: () => customFetch<AssignedPhysicianRow[]>(`/api/patients/${patientId}/physicians`),
    enabled: Number.isFinite(patientId) && patientId > 0 && patientQuery.isSuccess,
  });

  const patient = patientQuery.data;
  const resultList = useMemo(
    () => (Array.isArray(resultsQuery.data) ? resultsQuery.data : []),
    [resultsQuery.data],
  );

  const filteredResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resultList.filter((r) => {
      if (statusFilter !== "all" && String(r.status ?? "released") !== statusFilter) return false;
      if (!inDateBucket(r.dateReleased ?? r.uploadedAt, dateFilter)) return false;
      return matchesResultSearch(r, q);
    });
  }, [resultList, search, statusFilter, dateFilter]);

  const previewable = useMemo(
    () =>
      filteredResults.map((r) => {
        const base = toPreviewableResult(r);
        const override = reviewOverrides[r.id];
        return override ? { ...base, myReview: override } : base;
      }),
    [filteredResults, reviewOverrides],
  );

  const { selectedId, setSelectedId, selected } = useSelectedResult(previewable);
  const commentTarget = previewable.find((r) => r.id === commentResultId) ?? selected;

  const age = patient ? ageFromDob(patient.dateOfBirth) : null;
  const displayName = patient ? patientDisplayName(patient) : undefined;
  const tel = patient?.mobileNumber?.replace(/\s+/g, "") ?? "";
  const myAssignment = (physiciansQuery.data ?? []).find((row) => row.assignedAt);
  const assignedAt = myAssignment?.assignedAt
    ? new Date(myAssignment.assignedAt).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const releasedCount = resultList.filter((r) => (r.status ?? "released") === "released").length;

  const openResult = (id: number) => {
    setSelectedId(id);
    setTab("results");
    if (isCompactViewport()) setMobilePreviewOpen(true);
  };

  const openComment = (id: number) => {
    setSelectedId(id);
    setCommentResultId(id);
  };

  useEffect(() => {
    setReviewOverrides({});
    setCommentResultId(null);
    setSearch("");
    setStatusFilter("all");
    setDateFilter("all");
  }, [patientId]);

  const forbidden = patientQuery.isError;
  const loading = patientQuery.isLoading;

  return (
    <DoctorLayout fill hideHeaderActions>
      <div className="flex h-auto min-h-0 flex-col gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] xl:h-full xl:overflow-hidden xl:pb-0">
        <Link
          href="/physician/patients"
          className="inline-flex w-fit flex-shrink-0 items-center gap-2 text-sm doc-muted no-underline transition-colors hover:text-[hsl(var(--doc-green))]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to My Patients
        </Link>

        <div className="flex flex-shrink-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-[hsl(var(--doc-heading))] sm:text-2xl lg:text-[1.65rem]">
              Patient Profile
            </h1>
            <p className="mt-0.5 text-xs doc-muted sm:text-sm">
              View patient information, results, and manage your notes.
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

        {loading ? (
          <div className="doc-card space-y-3 rounded-2xl p-6">
            <Skeleton className="h-16" />
            <Skeleton className="h-10" />
          </div>
        ) : forbidden || !patient ? (
          <div className="doc-card rounded-2xl px-4 py-10 text-center">
            <p className="text-sm font-medium text-[hsl(var(--doc-text))]">Unable to load this patient.</p>
            <p className="mt-1 text-xs doc-muted">
              The patient may not be assigned to you, or the record could not be found.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4 rounded-xl"
              onClick={() => void patientQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Identity card */}
            <section className="doc-card flex flex-shrink-0 flex-col gap-4 rounded-2xl px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
                <PatientAvatar
                  firstName={patient.firstName}
                  lastName={patient.lastName}
                  size="lg"
                />
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold uppercase tracking-tight text-[hsl(var(--doc-text))] sm:text-xl">
                    {displayName}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs doc-muted sm:text-sm">
                    <span>
                      HIS ID:{" "}
                      <span className="font-mono font-semibold text-[hsl(var(--doc-green))]">
                        {patient.patientHisId}
                      </span>
                    </span>
                    <span aria-hidden>·</span>
                    <span>Sex: —</span>
                    <span aria-hidden>·</span>
                    <span>{age != null ? `${age} years old` : "Age —"}</span>
                    <span aria-hidden>·</span>
                    <span>DOB: {formatPatientDate(patient.dateOfBirth)}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[hsl(var(--doc-text))]">
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-[hsl(var(--doc-muted))]" />
                      {patient.mobileNumber?.trim() || "—"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-[hsl(var(--doc-muted))]" />
                      {patient.email?.trim() || "—"}
                    </span>
                    {assignedAt ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-[hsl(var(--doc-muted))]" />
                        Assigned: {assignedAt}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--doc-green-soft))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--doc-green))]">
                  <FileText className="h-3.5 w-3.5" />
                  {releasedCount} Released Result{releasedCount === 1 ? "" : "s"}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--doc-elevated))] px-3 py-1.5 text-xs font-semibold doc-muted">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Appointments unavailable
                </span>
              </div>
            </section>

            {/* Navigation cards */}
            <div className="grid flex-shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
              {TABS.map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                      active
                        ? "border-[hsl(var(--doc-green))] bg-[hsl(var(--doc-green-soft))]/70 shadow-sm"
                        : "border-[hsl(var(--doc-border))] bg-white hover:bg-[hsl(var(--doc-elevated))]/60"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                        active
                          ? "bg-white text-[hsl(var(--doc-green))]"
                          : "bg-[hsl(var(--doc-elevated))] text-[hsl(var(--doc-text))]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-sm font-semibold ${
                          active ? "text-[hsl(var(--doc-green))]" : "text-[hsl(var(--doc-text))]"
                        }`}
                      >
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug doc-muted">
                        {item.subtitle}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Tab panels */}
            {tab === "overview" ? (
              <section className="doc-card min-h-0 flex-1 overflow-auto rounded-2xl p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-semibold text-[hsl(var(--doc-text))]">
                  Patient information
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["Full name", displayName ?? "—"],
                      ["HIS ID", patient.patientHisId],
                      ["Date of birth", formatPatientDate(patient.dateOfBirth)],
                      ["Age", age != null ? `${age} years` : "—"],
                      ["Sex", "—"],
                      ["Contact number", patient.mobileNumber?.trim() || "—"],
                      ["Email", patient.email?.trim() || "—"],
                      ["Address", "—"],
                      ["Assigned to you", assignedAt ?? "—"],
                      ["Released results", String(releasedCount)],
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-elevated))]/40 px-3 py-2.5"
                    >
                      <p className="text-[11px] font-medium uppercase tracking-wide doc-muted">
                        {label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[hsl(var(--doc-text))] break-words">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                {(physiciansQuery.data?.length ?? 0) > 0 ? (
                  <p className="mt-4 text-xs doc-muted">
                    Assigned physicians:{" "}
                    {(physiciansQuery.data ?? []).map((row) => row.name).join(", ")}
                  </p>
                ) : null}
              </section>
            ) : null}

            {tab === "appointments" ? (
              <section className="doc-card flex min-h-[16rem] flex-1 flex-col items-center justify-center rounded-2xl px-6 py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(var(--doc-elevated))]">
                  <CalendarDays className="h-8 w-8 text-[hsl(var(--doc-muted))]" />
                </div>
                <p className="font-semibold text-[hsl(var(--doc-text))]">
                  Appointment information unavailable
                </p>
                <p className="mt-1 max-w-md text-sm doc-muted">
                  Physician scheduling is not connected yet. Schedule history will appear here once
                  ShanScheduler appointments are available for doctors.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 rounded-xl"
                  onClick={() => setLocation("/physician/appointments")}
                >
                  Open Appointments page
                </Button>
              </section>
            ) : null}

            {tab === "notes" ? (
              <section className="doc-scroll min-h-0 flex-1 overflow-auto">
                <div className="doc-card mb-3 rounded-2xl px-4 py-3">
                  <p className="text-sm font-semibold text-[hsl(var(--doc-text))]">Notes</p>
                  <p className="mt-1 text-xs doc-muted">
                    Freeform patient notes are not available. Prescriptions you create for this
                    patient are shown below through the existing authorized API.
                  </p>
                </div>
                <PhysicianPatientPrescriptions
                  patientId={patient.id}
                  patientName={`${patient.lastName}, ${patient.firstName}`}
                />
              </section>
            ) : null}

            {tab === "results" ? (
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] xl:overflow-hidden">
                {/* Results list */}
                <section className="doc-card flex min-h-[20rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:h-full">
                  <div className="flex flex-shrink-0 items-center gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                      <FileText className="h-4 w-4" />
                    </span>
                    <h2 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Results</h2>
                  </div>

                  <div className="flex flex-shrink-0 flex-col gap-2 px-3 py-3 sm:px-4">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--doc-muted))]" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by study, file name, or date..."
                        className="h-10 w-full rounded-xl border border-[hsl(var(--doc-border))] bg-white pl-9 pr-3 text-sm outline-none focus:border-[hsl(var(--doc-green))]"
                        aria-label="Search results"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className={docSelectTrigger} aria-label="Status filter">
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
                        <SelectTrigger className={docSelectTrigger} aria-label="Date filter">
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
                  </div>

                  <div className="doc-scroll min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-3 sm:px-4">
                    {resultsQuery.isLoading ? (
                      [...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)
                    ) : resultsQuery.isError ? (
                      <EmptyState
                        icon={FileText}
                        title="Unable to load results"
                        description="Please try again."
                        compact
                      />
                    ) : previewable.length === 0 ? (
                      <EmptyState
                        icon={FileText}
                        title="No results found"
                        description={
                          search || statusFilter !== "all" || dateFilter !== "all"
                            ? "No results match your search or filters."
                            : "Released results for this patient will appear here."
                        }
                        compact
                      />
                    ) : (
                      previewable.map((result) => {
                        const active = result.id === selectedId;
                        const study =
                          result.title ??
                          `${CATEGORY_LABELS[result.category] ?? result.category} Result`;
                        return (
                          <div
                            key={result.id}
                            className={`relative rounded-2xl border px-3 py-3 transition ${
                              active
                                ? "border-[hsl(var(--doc-green))] bg-[hsl(var(--doc-green-soft))]/50 shadow-sm"
                                : "border-[hsl(var(--doc-border))] bg-white hover:bg-[hsl(var(--doc-elevated))]/50"
                            }`}
                          >
                            {active ? (
                              <span className="absolute bottom-3 left-0 top-3 w-1 rounded-r-full bg-[hsl(var(--doc-green))]" />
                            ) : null}
                            <button
                              type="button"
                              className="flex w-full items-start gap-3 text-left"
                              onClick={() => openResult(result.id)}
                            >
                              <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                                <FileText className="h-5 w-5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-[hsl(var(--doc-text))]">
                                  {study}
                                </span>
                                <span className="mt-0.5 block truncate text-xs doc-muted">
                                  {result.originalFileName}
                                </span>
                                <span className="mt-1 flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] doc-muted">
                                    {formatResultDateTime(result.uploadedAt)}
                                  </span>
                                  <StatusBadge status={result.status ?? "released"} />
                                  {result.myReview?.reviewed ? (
                                    <span className="rounded-full bg-[hsl(var(--doc-blue-soft))] px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--doc-blue))]">
                                      Commented
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                            </button>
                            <div className="mt-3 flex flex-wrap items-center gap-2 pl-[3.25rem]">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 rounded-lg"
                                onClick={() => openResult(result.id)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 rounded-lg"
                                onClick={() => openComment(result.id)}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                                Comment
                              </Button>
                              <div className="relative ml-auto">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  aria-label="More actions"
                                  onClick={() =>
                                    setRowMenuId((id) => (id === result.id ? null : result.id))
                                  }
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                                {rowMenuId === result.id ? (
                                  <div className="absolute right-0 top-9 z-20 min-w-[9rem] rounded-xl border border-[hsl(var(--doc-border))] bg-white py-1 shadow-md">
                                    <button
                                      type="button"
                                      className="flex w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--doc-elevated))]"
                                      onClick={() => {
                                        openResult(result.id);
                                        setRowMenuId(null);
                                      }}
                                    >
                                      Open preview
                                    </button>
                                    <button
                                      type="button"
                                      className="flex w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--doc-elevated))]"
                                      onClick={() => {
                                        openComment(result.id);
                                        setRowMenuId(null);
                                      }}
                                    >
                                      Comment
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                {/* Selected result viewer */}
                <section className="hidden min-h-0 xl:block xl:h-full">
                  <DocumentPreviewPane
                    variant="profile"
                    result={selected}
                    patientName={displayName}
                    externalComment
                    onCommentClick={() => {
                      if (selected) setCommentResultId(selected.id);
                    }}
                    localReview={selected ? reviewOverrides[selected.id] ?? null : null}
                  />
                </section>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ResultPreviewSheet
        open={mobilePreviewOpen}
        onOpenChange={setMobilePreviewOpen}
        result={selected}
        patientName={displayName}
      />

      {commentTarget && commentResultId != null ? (
        <ResultCommentDialog
          resultId={commentTarget.id}
          myReview={commentTarget.myReview}
          open
          onOpenChange={(open) => {
            if (!open) setCommentResultId(null);
          }}
          fileLabel={commentTarget.originalFileName}
          onSaved={(review) => {
            setReviewOverrides((prev) => ({ ...prev, [commentTarget.id]: review }));
            void resultsQuery.refetch();
          }}
        />
      ) : null}

      <PhysicianSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </DoctorLayout>
  );
}
