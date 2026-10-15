import { useEffect, useMemo, useState, type ElementType } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DoctorLayout } from "@/components/layout/doctor-layout";
import { NotificationsMenu } from "@/components/doctor/notifications-menu";
import { PhysicianSettingsDialog } from "@/components/doctor/settings-dialog";
import { LiveClock } from "@/components/doctor/widgets";
import { Button } from "@/components/ui/button";
import { fetchMessageUnreadCount } from "@/lib/comms-api";
import {
  APPOINTMENT_STATUS_OPTIONS,
  APPOINTMENT_TYPE_OPTIONS,
  addDays,
  addMonths,
  buildMonthGrid,
  datesWithAppointments,
  fetchDoctorAppointments,
  filterAppointments,
  formatLongDate,
  formatMonthYear,
  formatWeekday,
  sameDay,
  startOfDay,
  summarizeDay,
  summarizePeriod,
  toIsoDate,
  type DoctorAppointmentStatus,
  type DoctorAppointmentType,
} from "@/lib/doctor-appointments";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Mail,
  Search,
  Settings,
  XCircle,
} from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ElementType;
  tone: "green" | "blue" | "mint" | "red";
}) {
  const tones = {
    green: {
      wrap: "border-[hsl(var(--doc-green))]/20 bg-[hsl(var(--doc-green-soft))]/35",
      icon: "bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]",
    },
    mint: {
      wrap: "border-[hsl(var(--doc-green))]/15 bg-white",
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
  }[tone];

  return (
    <div className={`doc-card flex items-center gap-3 rounded-2xl border px-3 py-3 sm:px-4 ${tones.wrap}`}>
      <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${tones.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tracking-tight text-[hsl(var(--doc-text))]">{value}</p>
        <p className="mt-1 text-sm font-semibold text-[hsl(var(--doc-text))]">{label}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  const styles: Record<string, string> = {
    scheduled: "bg-[hsl(var(--doc-blue-soft))] text-[hsl(var(--doc-blue))]",
    in_progress: "bg-[hsl(var(--doc-blue-soft))] text-[hsl(var(--doc-blue))]",
    completed: "bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]",
    cancelled: "bg-[hsl(var(--doc-maroon-soft))] text-[hsl(var(--doc-maroon))]",
  };
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
        styles[normalized] ?? "bg-[hsl(var(--doc-elevated))] doc-muted"
      }`}
    >
      {label}
    </span>
  );
}

export default function PhysicianAppointmentsPage() {
  const [, setLocation] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [viewMonth, setViewMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DoctorAppointmentStatus>("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | DoctorAppointmentType | string>("all");

  const unreadMessagesQuery = useQuery({
    queryKey: ["message-unread-count"],
    queryFn: fetchMessageUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const messageUnread = unreadMessagesQuery.data?.count ?? 0;

  const appointmentsQuery = useQuery({
    queryKey: ["doctor-appointments"],
    queryFn: fetchDoctorAppointments,
    staleTime: 30_000,
    retry: 1,
  });

  const load = appointmentsQuery.data;
  const appointments =
    load && load.status !== "loading" && "appointments" in load ? load.appointments : [];
  const isLoading = appointmentsQuery.isLoading || load?.status === "loading";
  const isUnavailable = load?.status === "unavailable";
  const isError = appointmentsQuery.isError || load?.status === "error";
  const errorMessage =
    load && (load.status === "error" || load.status === "unavailable")
      ? load.message
      : "Unable to load appointments. Please try again.";

  const today = startOfDay(new Date());
  const todayIso = toIsoDate(today);
  const selectedIso = toIsoDate(selectedDate);

  const period = useMemo(() => summarizePeriod(appointments, todayIso), [appointments, todayIso]);
  const daySummary = useMemo(() => summarizeDay(appointments, selectedIso), [appointments, selectedIso]);
  const markedDates = useMemo(() => datesWithAppointments(appointments), [appointments]);
  const monthCells = useMemo(() => buildMonthGrid(viewMonth, today), [viewMonth, today]);

  const filtered = useMemo(
    () =>
      filterAppointments(appointments, {
        search,
        status: statusFilter,
        department: departmentFilter,
        appointmentType: typeFilter,
        selectedIso,
      }),
    [appointments, search, statusFilter, departmentFilter, typeFilter, selectedIso],
  );

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of appointments) {
      const name = row.departmentName?.trim();
      if (name) set.add(name);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [appointments]);

  // Keep month view aligned when jumping via Today / date nav.
  useEffect(() => {
    setViewMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [selectedDate]);

  const goToday = () => setSelectedDate(startOfDay(new Date()));
  const kpiValue = (n: number) => {
    if (isLoading) return "…";
    if (isUnavailable || isError) return "—";
    return String(n);
  };

  const showEmptySuccess =
    !isLoading && !isError && !isUnavailable && filtered.length === 0;
  const showUnavailableEmpty = !isLoading && (isUnavailable || isError) && filtered.length === 0;

  return (
    <DoctorLayout fill hideHeaderActions>
      <div className="flex h-auto min-h-0 flex-col gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:h-full lg:overflow-hidden lg:pb-0">
        {/* Header */}
        <div className="flex flex-shrink-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-[hsl(var(--doc-heading))] sm:text-2xl lg:text-[1.65rem]">
              Appointments
            </h1>
            <p className="mt-0.5 text-xs doc-muted sm:text-sm">
              View and manage your scheduled appointments.
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

        {/* KPI row — appointments are read-only from ShanScheduler */}
        <div className="grid flex-shrink-0 grid-cols-2 gap-2 xl:grid-cols-4 xl:gap-3">
          <KpiCard
            tone="green"
            icon={CalendarDays}
            value={kpiValue(period.todayTotal)}
            label="Today's Appointments"
          />
          <KpiCard
            tone="blue"
            icon={Clock3}
            value={kpiValue(period.inProgress)}
            label="In Progress"
          />
          <KpiCard
            tone="mint"
            icon={CheckCircle2}
            value={kpiValue(period.completedToday)}
            label="Completed Today"
          />
          <KpiCard
            tone="red"
            icon={XCircle}
            value={kpiValue(period.cancelled)}
            label="Cancelled"
          />
        </div>

        {/* Toolbar */}
        <div className="doc-card flex flex-shrink-0 flex-col gap-2 rounded-2xl px-3 py-3 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="relative min-w-0 flex-1 lg:min-w-[14rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--doc-muted))]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient name, HIS ID, or department..."
              className="h-10 w-full rounded-xl border border-[hsl(var(--doc-border))] bg-white pl-9 pr-3 text-sm outline-none focus:border-[hsl(var(--doc-green))]"
              aria-label="Search appointments"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 rounded-xl border border-[hsl(var(--doc-border))] bg-white px-3 text-sm"
            aria-label="Status filter"
          >
            {APPOINTMENT_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="h-10 rounded-xl border border-[hsl(var(--doc-border))] bg-white px-3 text-sm"
            aria-label="Department filter"
          >
            <option value="all">All Departments</option>
            {departmentOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-10 rounded-xl border border-[hsl(var(--doc-border))] bg-white px-3 text-sm"
            aria-label="Appointment type filter"
          >
            {APPOINTMENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl border-[hsl(var(--doc-border))] px-3"
              onClick={goToday}
            >
              Today
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-10 w-10 rounded-xl"
              aria-label="Previous day"
              onClick={() => setSelectedDate((d) => addDays(d, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-10 w-10 rounded-xl"
              aria-label="Next day"
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="inline-flex h-10 items-center rounded-xl border border-[hsl(var(--doc-border))] bg-white px-3 text-sm font-semibold text-[hsl(var(--doc-text))]">
              {formatMonthYear(selectedDate)}
            </div>
          </div>
        </div>

        {/* Workspace */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)] xl:overflow-hidden">
          {/* Calendar column */}
          <aside className="doc-card flex min-h-[22rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:h-full">
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
              <h2 className="text-sm font-semibold text-[hsl(var(--doc-text))]">{formatMonthYear(viewMonth)}</h2>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  aria-label="Previous month"
                  onClick={() => setViewMonth((m) => addMonths(m, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  aria-label="Next month"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-shrink-0 px-3 py-3 sm:px-4">
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide doc-muted">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {monthCells.map((cell) => {
                  const selected = sameDay(cell.date, selectedDate);
                  const hasAppt = markedDates.has(cell.iso);
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelectedDate(startOfDay(cell.date))}
                      className={`relative flex h-9 flex-col items-center justify-center rounded-lg text-xs font-semibold transition ${
                        selected
                          ? "bg-[hsl(var(--doc-green))] text-white shadow-sm"
                          : cell.isToday
                            ? "bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]"
                            : cell.inCurrentMonth
                              ? "text-[hsl(var(--doc-text))] hover:bg-[hsl(var(--doc-elevated))]"
                              : "text-[hsl(var(--doc-muted))]/50 hover:bg-[hsl(var(--doc-elevated))]/60"
                      }`}
                      aria-label={formatLongDate(cell.date)}
                      aria-current={selected ? "date" : undefined}
                    >
                      {cell.date.getDate()}
                      {hasAppt ? (
                        <span
                          className={`absolute bottom-1 h-1 w-1 rounded-full ${
                            selected ? "bg-white" : "bg-[hsl(var(--doc-green))]"
                          }`}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-auto border-t border-[hsl(var(--doc-border))] px-3 py-3 sm:px-4">
              <p className="text-sm font-semibold text-[hsl(var(--doc-text))]">{formatLongDate(selectedDate)}</p>
              <p className="text-xs doc-muted">{formatWeekday(selectedDate)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    ["Total", daySummary.total, "bg-[hsl(var(--doc-elevated))]"],
                    ["Scheduled", daySummary.scheduled, "bg-[hsl(var(--doc-blue-soft))]"],
                    ["In Progress", daySummary.inProgress, "bg-[hsl(var(--doc-blue-soft))]"],
                    ["Completed", daySummary.completed, "bg-[hsl(var(--doc-green-soft))]"],
                  ] as const
                ).map(([label, count, bg]) => (
                  <div key={label} className={`rounded-xl px-3 py-2 ${bg}`}>
                    <p className="text-lg font-bold leading-none text-[hsl(var(--doc-text))]">
                      {isLoading ? "…" : isUnavailable || isError ? "—" : count}
                    </p>
                    <p className="mt-1 text-[11px] font-medium doc-muted">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* List column */}
          <section className="doc-card flex min-h-[22rem] flex-col overflow-hidden rounded-2xl xl:min-h-0 xl:h-full">
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-2.5 sm:px-4">
              <h2 className="text-sm font-semibold text-[hsl(var(--doc-text))]">
                Appointments for {formatLongDate(selectedDate)}
              </h2>
              <p className="text-xs font-semibold doc-muted">
                {isLoading ? "…" : `${filtered.length} appointment${filtered.length === 1 ? "" : "s"}`}
              </p>
            </div>

            <div className="doc-scroll min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 z-10 bg-[hsl(var(--doc-elevated))]">
                  <tr className="border-b border-[hsl(var(--doc-border))] text-left text-[11px] uppercase tracking-wide doc-muted">
                    <th className="px-4 py-2.5 font-semibold">Time</th>
                    <th className="px-3 py-2.5 font-semibold">Patient</th>
                    <th className="px-3 py-2.5 font-semibold">Department / Type</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-16 text-center text-sm doc-muted">
                        Loading appointments…
                      </td>
                    </tr>
                  ) : filtered.length > 0 ? (
                    filtered.map((row) => (
                      <tr key={row.id} className="border-b border-[hsl(var(--doc-border))] last:border-0">
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-[hsl(var(--doc-text))]">
                          {row.time ?? "—"}
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-[hsl(var(--doc-text))]">{row.patientName}</p>
                          <p className="font-mono text-xs doc-muted">
                            HIS ID: {row.patientHisId ?? "—"}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-[hsl(var(--doc-text))]">{row.departmentName ?? "—"}</p>
                          <p className="text-xs capitalize doc-muted">
                            {String(row.appointmentType ?? "—").replace(/_/g, " ")}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={String(row.status)} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg"
                            disabled
                            title="Appointment details are not available yet"
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : null}
                </tbody>
              </table>

              {showEmptySuccess || showUnavailableEmpty ? (
                <div className="flex min-h-[16rem] flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--doc-green-soft))]">
                    <CalendarDays className="h-9 w-9 text-[hsl(var(--doc-green))]" />
                  </div>
                  {isError ? (
                    <>
                      <p className="font-semibold text-[hsl(var(--doc-text))]">Unable to load appointments</p>
                      <p className="mt-1 max-w-sm text-sm doc-muted">{errorMessage}</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-4 rounded-xl"
                        onClick={() => void appointmentsQuery.refetch()}
                      >
                        Retry
                      </Button>
                    </>
                  ) : isUnavailable ? (
                    <>
                      <p className="font-semibold text-[hsl(var(--doc-text))]">No appointments for this date.</p>
                      <p className="mt-1 max-w-sm text-sm doc-muted">
                        There are no scheduled appointments yet. Appointments will appear here once available.
                      </p>
                      <p className="mt-3 max-w-md text-[11px] doc-muted">{errorMessage}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-[hsl(var(--doc-text))]">No appointments for this date.</p>
                      <p className="mt-1 max-w-sm text-sm doc-muted">
                        There are no scheduled appointments yet. Appointments will appear here once available.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <PhysicianSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </DoctorLayout>
  );
}
