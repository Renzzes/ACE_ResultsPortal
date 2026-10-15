import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getGetPortalOverviewQueryKey,
  getGetPortalResultsQueryKey,
  useGetPortalOverview,
  useGetPortalResults,
  ApiError,
  type PortalResult,
} from "@workspace/api-client-react";
import { PatientLayout } from "@/components/layout/patient-layout";
import { PatientProfileAvatar } from "@/components/portal/patient-profile-avatar";
import { PatientAccountDialog } from "@/components/portal/patient-account-dialog";
import { ContactSupportDialog } from "@/components/portal/contact-support-dialog";
import {
  ResultFileViewer,
  ResultViewButton,
  type ResultViewerState,
} from "@/components/portal/result-preview";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publicAsset } from "@/components/layout/auth-split-layout";
import {
  clearStoredPortalResultsAccessCodeOnLock,
  getStoredPortalResultsAccessCode,
} from "@/lib/portal-results-access";
import { fetchPortalMessageUnreadCount } from "@/lib/comms-api";
import {
  ageFromDob,
  formatPortalDate,
  formatPortalLongDate,
  portalFullName,
  portalPhotoKey,
  resultCategoryLabel,
  resultReleasedAt,
  resultStatusLabel,
  sortPortalResultsByRelease,
} from "@/lib/patient-identity";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronRightIcon,
  ExternalLink,
  Eye,
  FileText,
  Headphones,
  Lock,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Users,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

function formatReleaseStamp(iso?: string | null) {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }),
  };
}

function DocumentHeroIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-10 w-10 text-[#075C3B]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 8h14l8 8v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
      <path d="M28 8v8h8" />
      <path d="M18 24h12M18 30h12M18 36h8" />
    </svg>
  );
}

export default function PortalDashboardPage() {
  const [viewer, setViewer] = useState<ResultViewerState | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accessHelpOpen, setAccessHelpOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rowMenuId, setRowMenuId] = useState<number | null>(null);
  const [resultsUnlocked, setResultsUnlocked] = useState(() =>
    Boolean(getStoredPortalResultsAccessCode()),
  );

  const overviewQuery = useGetPortalOverview({
    query: { queryKey: getGetPortalOverviewQueryKey() },
  });
  const resultsQuery = useGetPortalResults({
    query: {
      queryKey: getGetPortalResultsQueryKey(),
      enabled: resultsUnlocked,
      retry: false,
    },
  });
  const messageUnreadQuery = useQuery({
    queryKey: ["portal-messages-unread", "dashboard"],
    queryFn: fetchPortalMessageUnreadCount,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
  const messageUnreadCount = messageUnreadQuery.data?.count ?? 0;

  const patient = overviewQuery.data?.patient;
  const doctors = overviewQuery.data?.assignedDoctors ?? [];
  const appointments = overviewQuery.data?.appointments;
  const nextAppointment = appointments?.next ?? null;
  const appointmentsUnavailable =
    appointments?.status === "unavailable" || appointments?.status === "unconfigured";
  const fullName = portalFullName(patient);
  const age = ageFromDob(patient?.dateOfBirth);
  const photoKey = portalPhotoKey(patient?.patientHisId, patient?.id);

  const sortedResults = useMemo(
    () => sortPortalResultsByRelease(resultsQuery.data ?? []),
    [resultsQuery.data],
  );
  const totalResults = sortedResults.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize) || 1);
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedResults.slice(start, start + pageSize);
  }, [sortedResults, page, pageSize]);

  const latestResult = sortedResults[0];
  const loading = overviewQuery.isLoading;
  const errored = overviewQuery.isError;
  const resultsRejected =
    resultsUnlocked &&
    resultsQuery.isError &&
    resultsQuery.error instanceof ApiError &&
    resultsQuery.error.status === 403;
  const resultsLocked = !resultsUnlocked || resultsRejected;

  useEffect(() => {
    if (!resultsRejected) return;
    clearStoredPortalResultsAccessCodeOnLock();
    setResultsUnlocked(false);
  }, [resultsRejected]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, resultsLocked, totalResults]);

  const doctorsLabel =
    doctors.length === 0
      ? "Not yet assigned"
      : doctors.length === 1
        ? doctors[0]?.name ?? "Assigned"
        : `${doctors.length} assigned`;

  const latestResultLabel = resultsLocked
    ? "Unlock to view"
    : latestResult
      ? formatPortalDate(resultReleasedAt(latestResult))
      : "Not yet available";

  return (
    <PatientLayout title="DASHBOARD" fill>
      {viewer ? <ResultFileViewer viewer={viewer} onClose={() => setViewer(null)} /> : null}

      <div className="flex h-auto min-h-0 flex-col gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] xl:h-full xl:overflow-hidden xl:pb-0">
        {/* Patient identity card */}
        <section className="flex-shrink-0 rounded-2xl border border-[#DFE9E4] bg-white px-4 py-4 shadow-[0_4px_16px_rgb(21_61_43_/_0.05)] sm:px-5">
          {loading ? (
            <div className="grid animate-pulse gap-4 lg:grid-cols-[auto_1fr_auto]">
              <div className="mx-auto h-20 w-20 rounded-full bg-[#E4F5EC] lg:mx-0" />
              <div className="space-y-3">
                <div className="h-4 w-28 rounded bg-[#E4F5EC]" />
                <div className="h-7 w-64 rounded bg-[#E4F5EC]" />
                <div className="h-4 w-full rounded bg-[#E4F5EC]" />
              </div>
              <div className="h-24 w-40 rounded bg-[#E4F5EC]" />
            </div>
          ) : errored || !patient ? (
            <div className="py-8 text-center">
              <p className="font-semibold text-[#101D3A]">Unable to load your information.</p>
              <button
                type="button"
                onClick={() => void overviewQuery.refetch()}
                className="mt-3 rounded-lg bg-[#07864B] px-4 py-2 text-sm font-semibold text-white"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-col items-center gap-3 sm:flex-row sm:items-start">
                <PatientProfileAvatar
                  patientId={photoKey}
                  firstName={patient.firstName}
                  lastName={patient.lastName}
                  fullName={fullName}
                  size="dashboard"
                  className="shadow-[0_8px_20px_rgb(21_61_43_/_0.14)]"
                />
                <div className="min-w-0 text-center sm:text-left">
                  <span className="inline-flex rounded-full bg-[#FBECEF] px-2.5 py-1 text-[11px] font-semibold text-[#A20F2F]">
                    Patient ID: {patient.patientHisId}
                  </span>
                  <h2 className="mt-2 text-[1.15rem] font-bold uppercase leading-tight tracking-tight text-[#101D3A] sm:text-[1.35rem]">
                    {fullName}
                  </h2>
                  <p className="mt-1.5 text-[13px] text-[#687A93]">
                    {age != null ? `${age} years old` : "Age —"}
                    {" · Sex — · DOB: "}
                    {formatPortalDate(patient.dateOfBirth)}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[13px] text-[#26364C] sm:justify-start">
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-[#07864B]" />
                      {patient.mobileNumber?.trim() || "—"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-[#07864B]" />
                      {patient.email?.trim() || "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="hidden h-24 w-px bg-[#DFE9E4] xl:block" aria-hidden />

              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3 xl:max-w-xl">
                <MetaRow
                  icon={CalendarDays}
                  label="Date of Birth"
                  value={formatPortalDate(patient.dateOfBirth)}
                />
                <MetaRow icon={Users} label="Assigned Doctors" value={doctorsLabel} />
                <MetaRow icon={FileText} label="Latest Result" value={latestResultLabel} />
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 rounded-xl border-[#DFE9E4] text-[#26364C] lg:self-start"
                onClick={() => setAccountOpen(true)}
              >
                <Pencil className="h-4 w-4" />
                Edit Profile
              </Button>
            </div>
          )}
        </section>

        {/* Main workspace */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.62fr)_minmax(0,0.38fr)] xl:overflow-hidden">
          {/* Left column */}
          <div className="flex min-h-0 flex-col gap-3 xl:overflow-hidden">
            {/* Hero */}
            <section className="relative flex-shrink-0 overflow-hidden rounded-2xl border border-[#DFE9E4] bg-gradient-to-r from-white via-[#F8FCF9] to-[#EAF7F0] shadow-[0_4px_16px_rgb(21_61_43_/_0.05)]">
              <div className="relative z-10 flex min-h-[10.5rem] flex-col justify-center gap-4 px-5 py-5 pb-28 sm:min-h-[11.5rem] sm:px-6 sm:py-6 sm:pb-6 sm:pr-[38%] md:min-h-[12.5rem] md:pr-[40%]">
                <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-[#E4F5EC] sm:h-[4.75rem] sm:w-[4.75rem]">
                    <DocumentHeroIcon />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h2 className="text-[1.35rem] font-bold leading-[1.15] tracking-tight text-[#101D3A] sm:text-[1.7rem]">
                      Your Diagnostic Results
                    </h2>
                    <p className="mt-2 max-w-[22rem] text-[13px] leading-relaxed text-[#687A93] sm:text-[14px]">
                      View your laboratory, radiology, and other diagnostic reports released by ACE
                      Medical Center.
                    </p>
                    <Link
                      href="/portal/results"
                      className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-[#07864B] px-4 text-sm font-semibold text-white no-underline shadow-[0_6px_16px_rgb(7_134_75_/_0.28)] transition hover:bg-[#075C3B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#07864B]"
                    >
                      <FileText className="h-4 w-4" strokeWidth={2} />
                      View My Results
                      <ChevronRightIcon className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
              <img
                src={publicAsset("LEAF_RESUTL_PATIENT_PORTAL1.png")}
                alt=""
                aria-hidden
                className="pointer-events-none absolute bottom-0 right-0 h-[9.5rem] w-auto max-w-[55%] object-contain object-right-bottom opacity-90 sm:h-[12.5rem] sm:max-w-[46%] sm:opacity-95 md:h-[14rem]"
              />
            </section>

            {/* Recent Results */}
            <section className="doc-card flex min-h-[16rem] flex-1 flex-col overflow-hidden rounded-2xl border border-[#DFE9E4] bg-white shadow-[0_4px_16px_rgb(21_61_43_/_0.05)] xl:min-h-0">
              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[#DFE9E4] px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E4F5EC] text-[#07864B]">
                    <FileText className="h-4 w-4" />
                  </span>
                  <h3 className="text-[15px] font-bold text-[#101D3A]">Recent Results</h3>
                </div>
                <Link
                  href="/portal/results"
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#07864B] no-underline hover:underline"
                >
                  View all
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {resultsQuery.isLoading ? (
                  <div className="space-y-2 px-4 py-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-12 animate-pulse rounded-xl bg-[#E4F5EC]" />
                    ))}
                  </div>
                ) : resultsLocked ? (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm font-semibold text-[#101D3A]">Results are locked</p>
                    <p className="mt-1 text-sm text-[#687A93]">
                      Enter your access code on the Results page to view recent diagnostic reports.
                    </p>
                    <Link
                      href="/portal/results"
                      className="mt-4 inline-flex rounded-xl bg-[#07864B] px-4 py-2 text-sm font-semibold text-white no-underline"
                    >
                      Unlock Results
                    </Link>
                  </div>
                ) : resultsQuery.isError ? (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm font-semibold text-[#101D3A]">Unable to load results</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 rounded-xl"
                      onClick={() => void resultsQuery.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : pageRows.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm font-semibold text-[#101D3A]">No released results found</p>
                    <p className="mt-1 text-sm text-[#687A93]">
                      Released diagnostic reports will appear here.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-[#DFE9E4] md:hidden">
                      {pageRows.map((item) => (
                        <ResultMobileCard key={item.id} result={item} onView={setViewer} />
                      ))}
                    </div>
                    <table className="hidden w-full min-w-[640px] text-left text-[13px] md:table">
                      <thead className="sticky top-0 bg-[#F3F6F4] text-[10px] font-semibold uppercase tracking-wide text-[#687A93]">
                        <tr>
                          <th className="px-4 py-2.5 sm:px-5">Date Released</th>
                          <th className="px-3 py-2.5">Study / Description</th>
                          <th className="px-3 py-2.5">Category</th>
                          <th className="px-3 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right sm:px-5">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((item) => (
                          <ResultRow
                            key={item.id}
                            result={item}
                            onView={setViewer}
                            menuOpen={rowMenuId === item.id}
                            onMenuToggle={() =>
                              setRowMenuId((id) => (id === item.id ? null : item.id))
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>

              {!resultsLocked && totalResults > 0 ? (
                <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#DFE9E4] px-4 py-2.5 sm:px-5">
                  <p className="text-xs text-[#687A93]">
                    Showing {pageRows.length} of {totalResults} result{totalResults === 1 ? "" : "s"}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 rounded-lg"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-[#07864B] px-2 text-xs font-bold text-white">
                      {page}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 rounded-lg"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                      <SelectTrigger className="h-8 w-[6.5rem] rounded-lg border-[#DFE9E4] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 20, 50].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} / page
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          {/* Right column */}
          <aside className="flex min-h-0 flex-col gap-3 xl:overflow-auto">
            <section
              id="portal-appointments"
              className="rounded-2xl border border-[#DFE9E4] bg-white p-4 shadow-[0_4px_16px_rgb(21_61_43_/_0.05)]"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E4F5EC] text-[#07864B]">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <h3 className="text-[15px] font-bold text-[#101D3A]">Appointments</h3>
                </div>
                <Link
                  href="/portal/history"
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#07864B] no-underline hover:underline"
                >
                  View all
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              {overviewQuery.isLoading ? (
                <div className="h-28 animate-pulse rounded-xl bg-[#E4F5EC]" />
              ) : appointmentsUnavailable ? (
                <EmptyPanel
                  icon={CalendarDays}
                  title="No upcoming appointments"
                  body={
                    appointments?.message ??
                    "Appointment information is temporarily unavailable. Please check again later or contact the hospital."
                  }
                />
              ) : nextAppointment ? (
                <div className="rounded-xl border border-[#DFE9E4] bg-[#F6F9F7] px-3 py-3">
                  <p className="text-sm font-bold text-[#101D3A]">
                    {nextAppointment.time ?? "Time TBD"}
                  </p>
                  <p className="mt-1 text-[13px] font-semibold text-[#075C3B]">
                    {nextAppointment.doctorName?.trim() || "Doctor not specified"}
                  </p>
                  <p className="mt-0.5 text-xs text-[#687A93]">
                    {formatPortalLongDate(nextAppointment.date)}
                    {" · "}
                    {nextAppointment.departmentName?.trim() ||
                      nextAppointment.specialtyName?.trim() ||
                      "Clinic not specified"}
                  </p>
                </div>
              ) : (
                <EmptyPanel
                  icon={CalendarDays}
                  title="No upcoming appointments"
                  body="You have no scheduled appointments at this time."
                />
              )}
            </section>

            <section className="rounded-2xl border border-[#DFE9E4] bg-white p-4 shadow-[0_4px_16px_rgb(21_61_43_/_0.05)]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E4F5EC] text-[#07864B]">
                    <MessageSquare className="h-4 w-4" />
                  </span>
                  <h3 className="text-[15px] font-bold text-[#101D3A]">Messages</h3>
                </div>
                <Link
                  href="/portal/messages"
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#07864B] no-underline hover:underline"
                >
                  View all
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              {messageUnreadQuery.isLoading ? (
                <div className="h-28 animate-pulse rounded-xl bg-[#E4F5EC]" />
              ) : messageUnreadCount > 0 ? (
                <div className="rounded-xl border border-[#DFE9E4] bg-[#F6F9F7] px-3 py-3">
                  <p className="text-sm font-bold text-[#101D3A]">
                    {messageUnreadCount} unread message{messageUnreadCount === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[#687A93]">
                    Open Messages to read updates from the hospital.
                  </p>
                  <Link
                    href="/portal/messages"
                    className="mt-3 inline-flex text-[13px] font-semibold text-[#07864B] no-underline hover:underline"
                  >
                    Open Messages
                  </Link>
                </div>
              ) : (
                <EmptyPanel
                  icon={MessageSquare}
                  title="No new messages"
                  body="You will see notifications from the hospital here."
                />
              )}
            </section>

            <section className="rounded-2xl border border-[#DFE9E4] bg-white p-4 shadow-[0_4px_16px_rgb(21_61_43_/_0.05)]">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FBECEF] text-[#A20F2F]">
                  <Headphones className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-[15px] font-bold text-[#101D3A]">Need Help?</h3>
                  <p className="mt-0.5 text-[12px] leading-snug text-[#687A93]">
                    If you cannot view your results or have questions, contact the hospital staff.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#A20F2F] text-sm font-semibold text-white transition hover:opacity-95"
              >
                <Headphones className="h-4 w-4" />
                Get Help
              </button>

              <div className="mt-3 rounded-xl border border-[#F3D5DB] bg-[#FBECEF] px-3 py-3">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#A20F2F]">
                    <Lock className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#A20F2F]">Results are secured</p>
                    <p className="mt-1 text-[12px] leading-snug text-[#8E3344]/90]">
                      You may be required to enter an access code to view your results. This code is
                      provided by the hospital.
                    </p>
                    <button
                      type="button"
                      onClick={() => setAccessHelpOpen(true)}
                      className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#A20F2F] underline underline-offset-2"
                    >
                      How to get my access code?
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>

      <PatientAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      <ContactSupportDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <AccessCodeInstructionsDialog open={accessHelpOpen} onOpenChange={setAccessHelpOpen} />
    </PatientLayout>
  );
}

function AccessCodeInstructionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[#DFE9E4] bg-white sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[#101D3A]">How to get your access code</DialogTitle>
          <DialogDescription className="text-[#687A93]">
            Your diagnostic results access code is issued by ACE Medical Center Cebu. It is separate from
            your Patient Portal password.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-3 pl-5 text-[13px] leading-relaxed text-[#26364C]">
          <li>
            Ask hospital staff at the Records / Results desk for your{" "}
            <span className="font-semibold">diagnostic results access code</span>.
          </li>
          <li>
            If an email is on your record, staff may also send the code to your registered email address.
          </li>
          <li>
            Open <span className="font-semibold">My Results</span> and enter the code when prompted to unlock
            your reports.
          </li>
          <li>
            If you still cannot unlock results, use the{" "}
            <span className="font-semibold">Get Help</span> button to contact hospital support.
          </li>
        </ol>
        <p className="rounded-xl border border-[#F3D5DB] bg-[#FBECEF] px-3 py-2.5 text-[12px] leading-snug text-[#8E3344]">
          Never share your access code in chat or email unless you are speaking directly with authorized
          hospital staff.
        </p>
        <Button
          type="button"
          className="h-11 w-full rounded-xl bg-[#07864B] font-semibold text-white hover:bg-[#075C3B]"
          onClick={() => onOpenChange(false)}
        >
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#E4F5EC] text-[#07864B]">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-[#687A93]">{label}</p>
        <p className="mt-0.5 text-[13px] font-semibold text-[#101D3A] [overflow-wrap:anywhere]">
          {value}
        </p>
      </div>
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof CalendarDays;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-[#F8F1F3] px-4 py-6 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#FBECEF] text-[#A20F2F]">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-bold text-[#A20F2F]">{title}</p>
      <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-[#687A93]">{body}</p>
    </div>
  );
}

function ResultMobileCard({
  result,
  onView,
}: {
  result: PortalResult;
  onView: (viewer: ResultViewerState) => void;
}) {
  const stamp = formatReleaseStamp(resultReleasedAt(result));
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs text-[#687A93]">
          {stamp.date}
          {stamp.time ? ` · ${stamp.time}` : ""}
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-[#101D3A]">
          {resultCategoryLabel(result.category)} Result
        </p>
        <p className="mt-0.5 truncate text-[11px] text-[#687A93]">{result.originalFileName}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-[#E4F5EC] px-2 py-0.5 text-[10px] font-semibold text-[#07864B]">
            {resultCategoryLabel(result.category)}
          </span>
          <span className="rounded-full bg-[#E4F5EC] px-2 py-0.5 text-[10px] font-semibold text-[#07864B]">
            {resultStatusLabel(result.status)}
          </span>
        </div>
      </div>
      <ResultViewButton
        result={result}
        onView={onView}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#DFE9E4] bg-white px-2.5 text-[11px] font-semibold text-[#26364C]"
      />
    </div>
  );
}

function ResultRow({
  result,
  onView,
  menuOpen,
  onMenuToggle,
}: {
  result: PortalResult;
  onView: (viewer: ResultViewerState) => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  const stamp = formatReleaseStamp(resultReleasedAt(result));
  const study = `${resultCategoryLabel(result.category)} Result`;
  return (
    <tr className="border-t border-[#DFE9E4]">
      <td className="whitespace-nowrap px-4 py-3 sm:px-5">
        <p className="font-medium text-[#101D3A]">{stamp.date}</p>
        <p className="text-[11px] text-[#687A93]">{stamp.time}</p>
      </td>
      <td className="px-3 py-3">
        <p className="font-semibold text-[#101D3A]">{study}</p>
        <p className="mt-0.5 max-w-[14rem] truncate text-[11px] text-[#687A93]" title={result.originalFileName}>
          {result.originalFileName}
        </p>
      </td>
      <td className="px-3 py-3">
        <span className="rounded-full bg-[#E4F5EC] px-2.5 py-0.5 text-[10px] font-semibold text-[#07864B]">
          {resultCategoryLabel(result.category)}
        </span>
      </td>
      <td className="px-3 py-3">
        <span className="rounded-full bg-[#E4F5EC] px-2.5 py-0.5 text-[10px] font-semibold text-[#07864B]">
          {resultStatusLabel(result.status)}
        </span>
      </td>
      <td className="px-4 py-3 text-right sm:px-5">
        <div className="relative inline-flex items-center gap-1">
          <ResultViewButton
            result={result}
            onView={onView}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#DFE9E4] bg-white px-2.5 text-[11px] font-semibold text-[#26364C] hover:border-[#07864B] hover:text-[#07864B]"
          >
            <Eye className="h-3.5 w-3.5" />
            View Report
          </ResultViewButton>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#687A93] hover:bg-[#F3F6F4]"
            aria-label="More actions"
            onClick={onMenuToggle}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-9 z-20 min-w-[9rem] rounded-xl border border-[#DFE9E4] bg-white py-1 shadow-md">
              <Link
                href="/portal/results"
                className="block px-3 py-2 text-left text-sm text-[#26364C] no-underline hover:bg-[#F3F6F4]"
              >
                Open My Results
              </Link>
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
