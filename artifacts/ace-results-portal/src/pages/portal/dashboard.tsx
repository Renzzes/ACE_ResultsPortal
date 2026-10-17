import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getGetPortalOverviewQueryKey,
  getGetPortalResultsQueryKey,
  useGetPortalOverview,
  useGetPortalResults,
  ApiError,
} from "@workspace/api-client-react";
import { PatientLayout } from "@/components/layout/patient-layout";
import { PatientProfileAvatar } from "@/components/portal/patient-profile-avatar";
import { PatientAccountDialog } from "@/components/portal/patient-account-dialog";
import { ContactSupportDialog } from "@/components/portal/contact-support-dialog";
import { PortalResultsUnlockDialog } from "@/components/portal/results-unlock-dialog";
import {
  ResultDocumentLoadingOverlay,
  ResultFileViewer,
  type ResultViewerState,
} from "@/components/portal/result-preview";
import { getPortalResultDownloadUrl } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publicAsset } from "@/components/layout/auth-split-layout";
import {
  beginPortalResultDownload,
  clearStoredPortalResultsAccessCodeOnLock,
  endPortalResultDownload,
  getStoredPortalResultAccessCode,
  unlockPortalResult,
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
  sortPortalResultsByRelease,
} from "@/lib/patient-identity";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  CalendarDays,
  ChevronRight as ChevronRightIcon,
  ExternalLink,
  FileText,
  Headphones,
  Lock,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortalResult } from "@workspace/api-client-react";

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
  const { portalAuth } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [viewer, setViewer] = useState<ResultViewerState | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accessHelpOpen, setAccessHelpOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [documentOpening, setDocumentOpening] = useState(false);
  const [unlockResultId, setUnlockResultId] = useState<number | null>(null);
  const [unlockedResultIds, setUnlockedResultIds] = useState<Set<number>>(() => new Set());

  const overviewQuery = useGetPortalOverview({
    query: { queryKey: getGetPortalOverviewQueryKey() },
  });
  // Catalog is available without an access code; content download still requires unlock.
  const resultsQuery = useGetPortalResults({
    query: {
      queryKey: getGetPortalResultsQueryKey(),
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
  const doctorsLabel =
    doctors.length === 0
      ? "Not yet assigned"
      : doctors.length === 1
        ? doctors[0]?.name ?? "Assigned"
        : `${doctors.length} assigned`;
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
  const latestResult = sortedResults[0] ?? null;

  const loading = overviewQuery.isLoading;
  const errored = overviewQuery.isError;
  const resultsRejected =
    resultsQuery.isError &&
    resultsQuery.error instanceof ApiError &&
    resultsQuery.error.status === 403;
  const anyLocked = sortedResults.some((r) => r.locked !== false && !unlockedResultIds.has(r.id));

  async function openResultDocument(result: NonNullable<typeof latestResult>) {
    setDocumentOpening(true);
    beginPortalResultDownload(result.id);
    try {
      const data = await getPortalResultDownloadUrl(result.id);
      if (!data?.url) {
        toast({
          title: "Document unavailable",
          description: "The authorized file could not be opened. Try again from My Results.",
          variant: "destructive",
        });
        return;
      }
      setViewer({
        url: data.url,
        fileType: result.fileType,
        fileName: result.originalFileName,
        title: result.originalFileName,
        meta: resultCategoryLabel(result.category),
      });
    } catch {
      toast({
        title: "Unable to open document",
        description: "Authorization failed or the file is missing. Try unlocking again.",
        variant: "destructive",
      });
    } finally {
      endPortalResultDownload();
      setDocumentOpening(false);
    }
  }

  useEffect(() => {
    if (!resultsRejected) return;
    clearStoredPortalResultsAccessCodeOnLock();
    setUnlockedResultIds(new Set());
  }, [resultsRejected]);

  const latestResultLabel = latestResult
    ? formatPortalDate(resultReleasedAt(latestResult))
    : "Not yet available";

  async function handleUnlock(accessCode: string) {
    if (unlockResultId == null) {
      setUnlockError("Select a document to unlock.");
      return;
    }
    setUnlockBusy(true);
    setUnlockError(null);
    const outcome = await unlockPortalResult(unlockResultId, accessCode);
    setUnlockBusy(false);
    if (!outcome.ok) {
      setUnlockError(outcome.error ?? "Invalid access code.");
      return;
    }
    const target = sortedResults.find((row) => row.id === unlockResultId);
    setUnlockedResultIds((prev) => new Set(prev).add(unlockResultId));
    setUnlockOpen(false);
    setUnlockResultId(null);
    if (target) void openResultDocument(target);
  }

  async function handleRequestAccessCode() {
    setRequestBusy(true);
    setRequestMessage(null);
    try {
      const response = await fetch("/api/portal/request-access-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${portalAuth.token ?? ""}`,
        },
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        setRequestMessage(data.error ?? "Could not send your request. Try again later.");
        return;
      }
      const message =
        data.message ??
        "Your request was sent. Hospital staff will email a new access code when ready.";
      setRequestMessage(message);
      toast({ title: "Access code requested", description: message });
    } catch {
      setRequestMessage("Could not send your request. Try again later.");
    } finally {
      setRequestBusy(false);
    }
  }

  function handleUnlockAndView() {
    if (resultsQuery.isLoading || documentOpening) return;
    if (sortedResults.length === 0) {
      toast({
        title: "No released results yet",
        description: "When a diagnostic report is released, you can unlock and view it here.",
      });
      return;
    }
    setDocumentPickerOpen(true);
  }

  function handlePickDocument(resultId: number) {
    const target = sortedResults.find((row) => row.id === resultId);
    if (!target) return;
    setDocumentPickerOpen(false);
    if (getStoredPortalResultAccessCode(resultId) || unlockedResultIds.has(resultId)) {
      void openResultDocument(target);
      return;
    }
    setUnlockResultId(resultId);
    setUnlockError(null);
    setRequestMessage(null);
    setUnlockOpen(true);
  }

  return (
    <PatientLayout title="DASHBOARD" fill>
      {viewer ? (
        <ResultFileViewer
          viewer={viewer}
          onClose={() => setViewer(null)}
          onBackToResults={() => {
            setViewer(null);
            setLocation("/portal/results");
          }}
        />
      ) : null}
      {documentOpening ? <ResultDocumentLoadingOverlay /> : null}

      <PortalResultsUnlockDialog
        open={unlockOpen}
        busy={unlockBusy}
        error={unlockError}
        requestBusy={requestBusy}
        requestMessage={requestMessage}
        documentTitle={
          unlockResultId != null
            ? (() => {
                const row = sortedResults.find((r) => r.id === unlockResultId);
                return row
                  ? `${resultCategoryLabel(row.category)} · ${row.originalFileName}`
                  : null;
              })()
            : null
        }
        onSubmit={(code) => void handleUnlock(code)}
        onClose={() => {
          setUnlockOpen(false);
          setUnlockResultId(null);
        }}
        onRequestAccessCode={() => void handleRequestAccessCode()}
      />

      <PortalDocumentPickerDialog
        open={documentPickerOpen}
        results={sortedResults}
        locked={anyLocked}
        busy={documentOpening}
        onPick={handlePickDocument}
        onClose={() => setDocumentPickerOpen(false)}
      />

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

              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3 xl:max-w-2xl">
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
          {/* Left column — diagnostic hero; Available Documents nests inside when present */}
          <div className="flex min-h-0 flex-col xl:overflow-hidden">
            <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#DFE9E4] bg-gradient-to-r from-white via-[#F8FCF9] to-[#EAF7F0] shadow-[0_4px_16px_rgb(21_61_43_/_0.05)]">
              <div className="relative flex-shrink-0 overflow-hidden">
                <div
                  className={`relative z-10 flex flex-col justify-center gap-4 px-5 py-5 sm:px-6 sm:py-6 sm:pr-[38%] md:pr-[40%] ${
                    sortedResults.length > 0
                      ? "min-h-[10.5rem] pb-6"
                      : "min-h-[11rem] pb-28 sm:min-h-[12rem] sm:pb-6"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-[#E4F5EC] sm:h-[4.75rem] sm:w-[4.75rem]">
                      <DocumentHeroIcon />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <h2 className="text-[1.35rem] font-bold leading-[1.15] tracking-tight text-[#101D3A] sm:text-[1.7rem]">
                        Your Diagnostic Results
                      </h2>
                      <p className="mt-2 max-w-[24rem] text-[13px] leading-relaxed text-[#687A93] sm:text-[14px]">
                        View your laboratory, radiology, and other diagnostic reports released by ACE
                        Medical Center. An access code is required to unlock your documents.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleUnlockAndView()}
                        disabled={documentOpening || unlockBusy}
                        className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-[#07864B] px-4 text-sm font-semibold text-white shadow-[0_6px_16px_rgb(7_134_75_/_0.28)] transition hover:bg-[#075C3B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#07864B] disabled:opacity-70"
                      >
                        <Lock className="h-4 w-4" strokeWidth={2} />
                        Unlock &amp; View Results
                        <ChevronRightIcon className="h-4 w-4" />
                      </button>
                      <p className="mt-3 text-[12px] text-[#687A93]">
                        No access code? Contact the hospital staff or check your reference slip.
                      </p>
                    </div>
                  </div>
                </div>
                <img
                  src={publicAsset("LEAF_RESUTL_PATIENT_PORTAL1.png")}
                  alt=""
                  aria-hidden
                  className={`pointer-events-none absolute bottom-0 right-0 w-auto object-contain object-right-bottom opacity-90 sm:opacity-95 ${
                    sortedResults.length > 0
                      ? "h-[8.5rem] max-w-[42%] sm:h-[10.5rem] sm:max-w-[40%]"
                      : "h-[9.5rem] max-w-[55%] sm:h-[12.5rem] sm:max-w-[46%] md:h-[14rem]"
                  }`}
                />
              </div>

              {resultsQuery.isError ? (
                <div className="border-t border-[#DFE9E4] bg-white/80 px-5 py-6 text-center">
                  <p className="text-sm font-semibold text-[#101D3A]">Unable to load documents</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 rounded-xl"
                    onClick={() => void resultsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}

              {sortedResults.length > 0 ? (
                <div className="flex min-h-0 flex-1 flex-col border-t border-[#DFE9E4] bg-white/90 xl:min-h-0">
                  <div className="flex flex-shrink-0 items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#E4F5EC] text-[#07864B]">
                        <FileText className="h-4 w-4" />
                      </span>
                      <h3 className="truncate text-[15px] font-bold text-[#101D3A]">
                        Available Documents ({sortedResults.length})
                      </h3>
                    </div>
                    <span
                      className={`inline-flex flex-shrink-0 items-center gap-1 text-[12px] font-semibold ${
                        anyLocked ? "text-[#A20F2F]" : "text-[#07864B]"
                      }`}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      {anyLocked ? "Documents locked" : "Ready"}
                    </span>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 sm:px-5">
                    <ul className="space-y-2">
                      {sortedResults.map((result) => (
                        <AvailableDocumentRow key={result.id} result={result} />
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-[#DFE9E4] px-4 py-2.5 sm:px-5">
                    <p className="text-xs text-[#687A93]">
                      Showing {sortedResults.length} of {sortedResults.length} document
                      {sortedResults.length === 1 ? "" : "s"}
                    </p>
                    <Link
                      href="/portal/results"
                      className="text-[12px] font-semibold text-[#07864B] no-underline hover:underline"
                    >
                      Open My Results
                    </Link>
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
                  <ChevronRightIcon className="h-4 w-4" />
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
                  <ChevronRightIcon className="h-4 w-4" />
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
                    Includes updates from your care team and published doctor comments on results.
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
                  body="Published doctor comments and hospital messages will appear here."
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
            Use <span className="font-semibold">Unlock &amp; View Results</span> on the dashboard, or open{" "}
            <span className="font-semibold">My Results</span>, and enter the code when prompted.
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

function AvailableDocumentRow({ result }: { result: PortalResult }) {
  const released = formatPortalDate(resultReleasedAt(result));
  return (
    <li className="flex items-center gap-2 rounded-xl border border-[#DFE9E4] bg-white px-3 py-3 sm:gap-3 sm:px-4">
      <span
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase ${
          result.fileType === "pdf" ? "bg-[#FBECEF] text-[#A20F2F]" : "bg-[#E4F5EC] text-[#07864B]"
        }`}
      >
        {result.fileType === "pdf" ? "PDF" : result.fileType.slice(0, 4)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#101D3A]">
          {resultCategoryLabel(result.category)} Result
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-[#687A93]" title={result.originalFileName}>
          {result.originalFileName}
        </p>
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#26364C] sm:hidden">
          <CalendarDays className="h-3.5 w-3.5 text-[#07864B]" />
          {released}
        </p>
      </div>
      <div className="hidden min-w-[7rem] flex-shrink-0 text-right sm:block">
        <p className="inline-flex items-center gap-1 text-[12px] font-medium text-[#26364C]">
          <CalendarDays className="h-3.5 w-3.5 text-[#07864B]" />
          {released}
        </p>
        <p className="mt-0.5 text-[10px] text-[#687A93]">Released Date</p>
      </div>
    </li>
  );
}

function PortalDocumentPickerDialog({
  open,
  results,
  locked,
  busy,
  onPick,
  onClose,
}: {
  open: boolean;
  results: PortalResult[];
  locked: boolean;
  busy: boolean;
  onPick: (resultId: number) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="portal-document-picker-title"
        className="relative w-full max-w-lg rounded-2xl border border-[#DFE9E4] bg-white p-5 shadow-xl sm:p-6"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close document picker"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="portal-document-picker-title" className="pr-10 text-xl font-bold text-[#101D3A]">
          Choose a document
        </h2>
        <p className="mt-2 text-sm text-[#687A93]">
          Select which diagnostic report to open
          {locked ? ". Documents stay locked until you enter your access code." : "."}
        </p>

        <ul className="mt-4 max-h-[min(24rem,55vh)] space-y-2 overflow-auto">
          {results.map((result) => {
            const released = formatPortalDate(resultReleasedAt(result));
            return (
              <li key={result.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(result.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-[#DFE9E4] bg-[#F8FCF9] px-3 py-3 text-left transition hover:border-[#07864B] hover:bg-[#E4F5EC] disabled:opacity-70"
                >
                  <span
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase ${
                      result.fileType === "pdf"
                        ? "bg-[#FBECEF] text-[#A20F2F]"
                        : "bg-[#E4F5EC] text-[#07864B]"
                    }`}
                  >
                    {result.fileType === "pdf" ? "PDF" : result.fileType.slice(0, 4)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#101D3A]">
                      {resultCategoryLabel(result.category)} Result
                    </p>
                    <p
                      className="mt-0.5 truncate font-mono text-[11px] text-[#687A93]"
                      title={result.originalFileName}
                    >
                      {result.originalFileName}
                    </p>
                    <p className="mt-1 text-[11px] text-[#687A93]">Released {released}</p>
                  </div>
                  <ChevronRightIcon className="h-4 w-4 flex-shrink-0 text-[#07864B]" />
                </button>
              </li>
            );
          })}
        </ul>

        <Button type="button" variant="ghost" className="mt-4 h-10 w-full text-[#687A93]" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
