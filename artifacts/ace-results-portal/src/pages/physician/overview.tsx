import { useMemo, useState, type ElementType } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useListPatients,
  getListPatientsQueryKey,
  useListResults,
  getListResultsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { DoctorLayout } from "@/components/layout/doctor-layout";
import { NotificationsMenu } from "@/components/doctor/notifications-menu";
import { PhysicianSettingsDialog } from "@/components/doctor/settings-dialog";
import { LiveClock } from "@/components/doctor/widgets";
import { ageFromDob, CategoryBadge, EmptyState, Skeleton } from "@/components/doctor/shared";
import { Button } from "@/components/ui/button";
import { fetchMessageUnreadCount } from "@/lib/comms-api";
import {
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Eye,
  FileText,
  Mail,
  MoreVertical,
  Search,
  Settings,
  Users,
} from "lucide-react";

type ResultCategoryFilter = "all" | "laboratory" | "radiology" | "others";

const RADIOLOGY_CATEGORIES = new Set([
  "radiology",
  "ultrasound",
  "ct_scan",
  "mri",
  "ecg",
  "echo_2d",
  "rehabilitation",
]);

function formatDob(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatReleasedAt(value?: string | null, fallback?: string) {
  const raw = value || fallback;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function studyLabel(remarks?: string | null) {
  if (!remarks?.trim()) return "—";
  const first = remarks.trim().split(/\n+/)[0]?.trim();
  return first || "—";
}

function matchesCategoryFilter(category: string | undefined, filter: ResultCategoryFilter) {
  if (filter === "all") return true;
  const code = (category ?? "").toLowerCase();
  if (filter === "laboratory") return code === "laboratory";
  if (filter === "radiology") return RADIOLOGY_CATEGORIES.has(code);
  return code !== "laboratory" && !RADIOLOGY_CATEGORIES.has(code);
}

function MetricCard({
  label,
  subtitle,
  value,
  href,
  icon: Icon,
  tone,
}: {
  label: string;
  subtitle: string;
  value: string;
  href?: string;
  icon: ElementType;
  tone: "green" | "red" | "blue";
}) {
  const tones = {
    green: {
      wrap: "border-[hsl(var(--doc-green))]/20 bg-[hsl(var(--doc-green-soft))]/40",
      icon: "bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]",
    },
    red: {
      wrap: "border-[hsl(var(--doc-maroon))]/15 bg-[hsl(var(--doc-maroon-soft))]/50",
      icon: "bg-[hsl(var(--doc-maroon-soft))] text-[hsl(var(--doc-maroon))]",
    },
    blue: {
      wrap: "border-[hsl(var(--doc-blue))]/15 bg-[hsl(var(--doc-blue-soft))]",
      icon: "bg-[hsl(var(--doc-blue-soft))] text-[hsl(var(--doc-blue))]",
    },
  }[tone];

  const body = (
    <div
      className={`doc-card flex h-full items-center gap-2.5 rounded-2xl border px-3 py-3 transition hover:shadow-md sm:gap-3 sm:px-4 ${tones.wrap}`}
    >
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${tones.icon}`}>
        <Icon className="h-4.5 w-4.5 h-[1.125rem] w-[1.125rem]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-bold leading-none tracking-tight text-[hsl(var(--doc-text))] sm:text-2xl">{value}</p>
        <p className="mt-0.5 text-sm font-semibold text-[hsl(var(--doc-text))]">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug doc-muted sm:text-xs">{subtitle}</p>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-[hsl(var(--doc-muted))]" />
    </div>
  );

  if (!href) {
    return <div className="min-w-0">{body}</div>;
  }
  return (
    <Link href={href} className="block min-w-0 no-underline">
      {body}
    </Link>
  );
}

export default function PhysicianOverview() {
  const { auth } = useAuth();
  const [, setLocation] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultCategoryFilter>("all");
  const [appointmentDate, setAppointmentDate] = useState(() => new Date());
  const [appointmentTab, setAppointmentTab] = useState<"all" | "scheduled" | "in_progress" | "completed">("all");

  const unreadMessagesQuery = useQuery({
    queryKey: ["message-unread-count"],
    queryFn: fetchMessageUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const messageUnread = unreadMessagesQuery.data?.count ?? 0;

  const patientsQuery = useListPatients(
    { page: 1, limit: 8 },
    { query: { queryKey: getListPatientsQueryKey({ page: 1, limit: 8 }) } },
  );
  const resultsQuery = useListResults(
    { page: 1, limit: 12, status: "released" } as any,
    { query: { queryKey: getListResultsQueryKey({ page: 1, limit: 12, status: "released" } as any) } },
  );

  const patients = patientsQuery.data?.data ?? [];
  const patientTotal = patientsQuery.data?.total ?? 0;
  const results = resultsQuery.data?.data ?? [];
  const resultTotal = resultsQuery.data?.total ?? 0;

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => {
      const name = `${p.lastName}, ${p.firstName}`.toLowerCase();
      return name.includes(q) || p.patientHisId.toLowerCase().includes(q);
    });
  }, [patients, patientSearch]);

  const filteredResults = useMemo(() => {
    const q = resultSearch.trim().toLowerCase();
    return results.filter((r) => {
      if (!matchesCategoryFilter(r.category, resultFilter)) return false;
      if (!q) return true;
      const hay = [
        r.patientName,
        r.patientHisId,
        r.originalFileName,
        r.remarks,
        r.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [results, resultSearch, resultFilter]);

  const welcomeName = auth.user?.lastName || auth.user?.firstName || "Physician";

  const shiftAppointmentDate = (delta: number) => {
    setAppointmentDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + delta);
      return next;
    });
  };

  const appointmentDateLabel = appointmentDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const isToday =
    appointmentDate.toDateString() === new Date().toDateString();

  return (
    <DoctorLayout fill hideHeaderActions>
      <div className="flex h-auto min-h-0 flex-col gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:h-full lg:gap-3 lg:overflow-hidden lg:pb-0">
        {/* Welcome + utilities — fixed height band */}
        <div className="flex flex-shrink-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-[hsl(var(--doc-heading))] sm:text-2xl lg:text-[1.65rem]">
              Welcome Dr. {welcomeName}.
            </h2>
            <p className="mt-0.5 text-xs doc-muted sm:text-sm">
              Your assigned patients and released results from ACE Results Portal.
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
            <div className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--doc-border))] bg-white px-3 py-1.5 text-sm font-medium shadow-sm">
              <Calendar className="h-4 w-4 text-[hsl(var(--doc-green))]" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="text-xs sm:text-sm">
                  {new Date().toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <span className="text-[11px] font-normal doc-muted">
                  {new Date().toLocaleDateString("en-US", { weekday: "long" })}
                </span>
              </span>
            </div>
            <LiveClock />
          </div>
        </div>

        {/* Summary cards — fixed height band */}
        <div className="grid flex-shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 xl:gap-3">
          <MetricCard
            tone="green"
            icon={Users}
            value={patientsQuery.isLoading ? "…" : String(patientTotal)}
            label="My Patients"
            subtitle="Total patients assigned to you"
            href="/physician/patients"
          />
          <MetricCard
            tone="green"
            icon={FileText}
            value={resultsQuery.isLoading ? "…" : String(resultTotal)}
            label="Released Results"
            subtitle="Results released for your patients"
            href="/physician/results"
          />
          <MetricCard
            tone="red"
            icon={CalendarDays}
            value="0"
            label="Today's Appointments"
            subtitle="Scheduled for today"
            href="/physician/appointments"
          />
          <MetricCard
            tone="blue"
            icon={CreditCard}
            value="0"
            label="Pending Payments"
            subtitle="For your services"
            href="/physician/payments"
          />
        </div>

        {/* Main grid — fills remaining viewport; panels scroll internally */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] xl:overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-col gap-3 xl:overflow-hidden">
            {/* Recent Assigned Patients */}
            <section className="doc-card flex min-h-[16rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:flex-1">
              <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                    <Users className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Recent Assigned Patients</h3>
                </div>
                <Link
                  href="/physician/patients"
                  className="text-sm font-semibold text-[hsl(var(--doc-green))] no-underline hover:underline"
                >
                  View all →
                </Link>
              </div>
              <div className="flex flex-shrink-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:px-4">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--doc-muted))]" />
                  <input
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    placeholder="Search patient name or HIS ID..."
                    className="h-9 w-full rounded-xl border border-[hsl(var(--doc-border))] bg-white pl-9 pr-3 text-sm outline-none focus:border-[hsl(var(--doc-green))]"
                  />
                </div>
                <select
                  className="h-9 rounded-xl border border-[hsl(var(--doc-border))] bg-white px-3 text-sm"
                  defaultValue="all"
                  aria-label="Patient filter"
                >
                  <option value="all">All</option>
                </select>
              </div>
              <div className="doc-scroll min-h-0 flex-1 overflow-auto">
                {patientsQuery.isLoading ? (
                  <div className="space-y-2 px-4 pb-3">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                ) : patientsQuery.isError ? (
                  <div className="px-4 py-6 text-center text-sm doc-muted">Unable to load your patients.</div>
                ) : filteredPatients.length === 0 ? (
                  <EmptyState
                    compact
                    icon={Users}
                    title="No assigned patients found."
                    description="Patients assigned to you will appear here."
                  />
                ) : (
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="sticky top-0 z-10 bg-[hsl(var(--doc-elevated))]">
                      <tr className="border-y border-[hsl(var(--doc-border))] text-left text-[11px] uppercase tracking-wide doc-muted">
                        <th className="px-4 py-2 font-semibold">HIS ID</th>
                        <th className="px-3 py-2 font-semibold">Patient Name</th>
                        <th className="px-3 py-2 font-semibold">Date of Birth</th>
                        <th className="px-3 py-2 font-semibold">Age / Sex</th>
                        <th className="px-3 py-2 font-semibold">Date Assigned</th>
                        <th className="px-4 py-2 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPatients.map((patient) => {
                        const age = ageFromDob(patient.dateOfBirth);
                        return (
                          <tr key={patient.id} className="border-b border-[hsl(var(--doc-border))] last:border-0">
                            <td className="px-4 py-2.5 font-mono text-xs text-[hsl(var(--doc-green))]">
                              {patient.patientHisId}
                            </td>
                            <td className="px-3 py-2.5 font-medium text-[hsl(var(--doc-text))]">
                              {patient.lastName}, {patient.firstName}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 doc-muted">{formatDob(patient.dateOfBirth)}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 doc-muted">
                              {age != null ? `${age} yrs` : "—"} • —
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 doc-muted">—</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-1">
                                <Link href={`/physician/patients/${patient.id}`}>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 gap-1.5 rounded-lg border-[hsl(var(--doc-border))]"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    View
                                  </Button>
                                </Link>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  aria-label={`More actions for ${patient.lastName}`}
                                  disabled
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
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

            {/* Recent Released Results */}
            <section className="doc-card flex min-h-[16rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:flex-1">
              <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Recent Released Results</h3>
                </div>
                <Link
                  href="/physician/results"
                  className="text-sm font-semibold text-[hsl(var(--doc-green))] no-underline hover:underline"
                >
                  View all →
                </Link>
              </div>
              <div className="flex flex-shrink-0 flex-col gap-2 px-3 py-2 sm:px-4">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--doc-muted))]" />
                  <input
                    value={resultSearch}
                    onChange={(e) => setResultSearch(e.target.value)}
                    placeholder="Search patient name, HIS ID, or study..."
                    className="h-9 w-full rounded-xl border border-[hsl(var(--doc-border))] bg-white pl-9 pr-3 text-sm outline-none focus:border-[hsl(var(--doc-green))]"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["all", "All"],
                      ["laboratory", "Laboratory"],
                      ["radiology", "Radiology"],
                      ["others", "Others"],
                    ] as const
                  ).map(([key, label]) => {
                    const active = resultFilter === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setResultFilter(key)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          active
                            ? "bg-[hsl(var(--doc-green))] text-white"
                            : "bg-[hsl(var(--doc-elevated))] text-[hsl(var(--doc-text))] hover:bg-[hsl(var(--doc-green-soft))]"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="doc-scroll min-h-0 flex-1 overflow-auto">
                {resultsQuery.isLoading ? (
                  <div className="space-y-2 px-4 pb-3">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                ) : resultsQuery.isError ? (
                  <EmptyState compact icon={FileText} title="Unable to load results" description="Please try again." />
                ) : filteredResults.length === 0 ? (
                  <EmptyState
                    compact
                    icon={FileText}
                    title="No released results found."
                    description="Released results for your assigned patients will appear here."
                  />
                ) : (
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="sticky top-0 z-10 bg-[hsl(var(--doc-elevated))]">
                      <tr className="border-y border-[hsl(var(--doc-border))] text-left text-[11px] uppercase tracking-wide doc-muted">
                        <th className="px-4 py-2 font-semibold">Released Date</th>
                        <th className="px-3 py-2 font-semibold">Patient Name</th>
                        <th className="px-3 py-2 font-semibold">Study / Description</th>
                        <th className="px-3 py-2 font-semibold">File</th>
                        <th className="px-4 py-2 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((result) => (
                        <tr key={result.id} className="border-b border-[hsl(var(--doc-border))] last:border-0">
                          <td className="whitespace-nowrap px-4 py-2.5 doc-muted">
                            {formatReleasedAt(result.dateReleased, result.uploadedAt)}
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-[hsl(var(--doc-text))]">
                              {result.patientName || "Patient"}
                            </p>
                            <p className="font-mono text-xs doc-muted">HIS ID: {result.patientHisId || "—"}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-col gap-1">
                              <CategoryBadge category={result.category} />
                              <span className="max-w-[12rem] truncate text-xs doc-muted">
                                {studyLabel(result.remarks)}
                              </span>
                            </div>
                          </td>
                          <td
                            className="max-w-[10rem] truncate px-3 py-2.5 text-xs doc-muted"
                            title={result.originalFileName}
                          >
                            {result.originalFileName}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <Link href="/physician/results">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 gap-1.5 rounded-lg border-[hsl(var(--doc-border))]"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  View
                                </Button>
                              </Link>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                aria-label={`More actions for ${result.originalFileName}`}
                                disabled
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>

          {/* Today's Appointments — full height of main band */}
          <section className="doc-card flex min-h-[18rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:h-full">
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--doc-maroon-soft))] text-[hsl(var(--doc-maroon))]">
                  <CalendarDays className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Today&apos;s Appointments</h3>
              </div>
              <Link
                href="/physician/appointments"
                className="text-sm font-semibold text-[hsl(var(--doc-green))] no-underline hover:underline"
              >
                View all →
              </Link>
            </div>

            <div className="flex flex-shrink-0 items-center justify-center gap-2 px-3 py-2.5 sm:px-4">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-xl"
                aria-label="Previous day"
                onClick={() => shiftAppointmentDate(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1 rounded-xl border border-[hsl(var(--doc-border))] px-3 py-1.5 text-center">
                <p className="truncate text-sm font-semibold text-[hsl(var(--doc-text))]">{appointmentDateLabel}</p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-xl"
                aria-label="Next day"
                onClick={() => shiftAppointmentDate(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-[hsl(var(--doc-border))] px-2">
              {(
                [
                  ["all", "All"],
                  ["scheduled", "Scheduled"],
                  ["in_progress", "In Progress"],
                  ["completed", "Completed"],
                ] as const
              ).map(([key, label]) => {
                const active = appointmentTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAppointmentTab(key)}
                    className={`whitespace-nowrap px-3 py-2 text-xs font-semibold ${
                      active
                        ? "border-b-2 border-[hsl(var(--doc-maroon))] text-[hsl(var(--doc-maroon))]"
                        : "text-[hsl(var(--doc-muted))]"
                    }`}
                  >
                    {label} 0
                  </button>
                );
              })}
            </div>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-6 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--doc-elevated))] text-[hsl(var(--doc-muted))]">
                <CalendarDays className="h-7 w-7" />
              </div>
              <p className="font-semibold text-[hsl(var(--doc-text))]">
                {isToday ? "No appointments today" : "No appointments for this date"}
              </p>
              <p className="mt-1 max-w-xs text-sm doc-muted">
                {isToday
                  ? "You have no scheduled appointments for this date."
                  : "Scheduling is not available in ACE Results Portal yet. No appointment records are shown."}
              </p>
            </div>
          </section>
        </div>
      </div>

      <PhysicianSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </DoctorLayout>
  );
}
