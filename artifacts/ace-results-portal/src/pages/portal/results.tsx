import { useEffect, useMemo, useState } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import {
  getGetPortalResultsQueryKey,
  useGetPortalResults,
  ApiError,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { PatientLayout } from "@/components/layout/patient-layout";
import { DepartmentFilter } from "@/components/portal/department-filter";
import { PortalResultsUnlockDialog } from "@/components/portal/results-unlock-dialog";
import {
  getStoredPortalResultsAccessCode,
  clearStoredPortalResultsAccessCodeOnLock,
  unlockPortalResults,
} from "@/lib/portal-results-access";
import {
  ResultDownloadButton,
  ResultFileViewer,
  ResultViewButton,
  type ResultViewerState,
} from "@/components/portal/result-preview";
import {
  DEPT_BADGE_CLASS,
  formatFileSize,
  formatPortalDate,
  resultCategoryLabel,
  resultReleasedAt,
  resultStatusLabel,
  sortPortalResultsByRelease,
} from "@/lib/patient-identity";
import { useToast } from "@/hooks/use-toast";
import { Download, Eye, FileText } from "lucide-react";

export default function PortalResultsPage() {
  const { portalAuth } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const searchStr = useSearch();
  const searchQuery = (new URLSearchParams(searchStr).get("q") ?? "").trim().toLowerCase();
  const focusResultId = Number(new URLSearchParams(searchStr).get("resultId") ?? "");
  const [category, setCategory] = useState("all");
  const [viewer, setViewer] = useState<ResultViewerState | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [resultsUnlocked, setResultsUnlocked] = useState(() => Boolean(getStoredPortalResultsAccessCode()));

  const resultsQuery = useGetPortalResults({
    query: {
      queryKey: getGetPortalResultsQueryKey(),
      enabled: Boolean(portalAuth.token) && resultsUnlocked,
      retry: false,
    },
  });

  const resultsLocked =
    resultsUnlocked &&
    resultsQuery.isError &&
    resultsQuery.error instanceof ApiError &&
    resultsQuery.error.status === 403;

  useEffect(() => {
    if (!resultsLocked) return;
    clearStoredPortalResultsAccessCodeOnLock();
    setResultsUnlocked(false);
  }, [resultsLocked]);

  async function handleUnlock(accessCode: string) {
    setUnlockBusy(true);
    setUnlockError(null);
    const result = await unlockPortalResults(accessCode);
    setUnlockBusy(false);
    if (!result.ok) {
      setUnlockError(result.error ?? "Invalid access code.");
      return;
    }
    setResultsUnlocked(true);
    void resultsQuery.refetch();
  }

  function handleCloseUnlock() {
    setLocation("/portal/dashboard");
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

  const resultList = useMemo(() => {
    const sorted = sortPortalResultsByRelease(resultsQuery.data ?? []);
    return sorted.filter((item) => {
      const categoryOk = category === "all" || item.category === category;
      if (!categoryOk) return false;
      if (!searchQuery) return true;
      const haystack = `${item.originalFileName} ${resultCategoryLabel(item.category)} ${item.remarks ?? ""}`.toLowerCase();
      return haystack.includes(searchQuery);
    });
  }, [category, resultsQuery.data, searchQuery]);

  if (!portalAuth.patient || !portalAuth.token) {
    return <Redirect to="/login" />;
  }

  return (
    <PatientLayout title="RESULTS">
      <PortalResultsUnlockDialog
        open={!resultsUnlocked || resultsLocked}
        busy={unlockBusy}
        error={unlockError}
        requestBusy={requestBusy}
        requestMessage={requestMessage}
        onSubmit={handleUnlock}
        onClose={handleCloseUnlock}
        onRequestAccessCode={() => void handleRequestAccessCode()}
      />
      {viewer && <ResultFileViewer viewer={viewer} onClose={() => setViewer(null)} />}

      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#17221D]">My diagnostic results</h2>
            <p className="text-sm text-[#64706A]">Released results from ACE Medical Center Cebu</p>
          </div>
          <DepartmentFilter value={category} onChange={setCategory} />
        </div>

        {resultsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl border border-[#DDE5E0] bg-[#E8F4EC]/60" />
            ))}
          </div>
        ) : resultsQuery.isError ? (
          <div className="rounded-2xl border border-[#DDE5E0] bg-white py-16 text-center">
            <p className="text-lg font-semibold text-[#17221D]">Unable to load your results. Please try again.</p>
            <button
              type="button"
              onClick={() => void resultsQuery.refetch()}
              className="mt-4 rounded-lg bg-[#2F7D4A] px-4 py-2 text-sm font-semibold text-white"
            >
              Retry
            </button>
          </div>
        ) : resultList.length === 0 ? (
          <div className="rounded-2xl border border-[#DDE5E0] bg-white py-16 text-center">
            <p className="text-lg font-semibold text-[#17221D]">
              {searchQuery || category !== "all"
                ? "No matching results"
                : "No released results found."}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-[#64706A]">
              {searchQuery
                ? "Try a different search, or clear the search field to see all released results."
                : category !== "all"
                  ? "Choose All to see every released result."
                  : "When a result is released for you, it will appear here."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {resultList.map((result) => {
              const sizeLabel = formatFileSize(result.fileSizeBytes);
              return (
                <article
                  key={result.id}
                  className={`rounded-2xl border bg-white p-4 shadow-[0_4px_16px_rgb(21_61_43_/_0.05)] sm:p-5 ${
                    Number.isFinite(focusResultId) && focusResultId === result.id
                      ? "border-[#2F7D4A] ring-2 ring-[#2F7D4A]/25"
                      : "border-[#DDE5E0]"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#F8ECEF]">
                        <FileText className="h-5 w-5 text-[#8E3344]" />
                      </div>
                      <div className="min-w-0">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            DEPT_BADGE_CLASS[result.category] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {resultCategoryLabel(result.category)}
                        </span>
                        <p className="mt-1 truncate font-medium text-[#17221D]">{result.originalFileName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[#64706A]">
                          <span className="uppercase">{result.fileType}</span>
                          <span>Released {formatPortalDate(resultReleasedAt(result))}</span>
                          <span className="font-semibold text-[#2F7D4A]">{resultStatusLabel(result.status)}</span>
                          {sizeLabel && <span>{sizeLabel}</span>}
                        </div>
                        {result.remarks && (
                          <p className="mt-1 text-xs italic text-[#64706A]">{result.remarks}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                      <ResultViewButton
                        result={result}
                        onView={setViewer}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[#2F7D4A] px-3 py-2 text-[12px] font-semibold text-white sm:flex-none disabled:opacity-70"
                      >
                        <Eye className="h-4 w-4" />
                        View
                      </ResultViewButton>
                      <ResultDownloadButton
                        result={result}
                        className="inline-flex items-center justify-center rounded-md border border-[#DDE5E0] px-3 py-2 text-[#17221D] disabled:opacity-70"
                      >
                        <Download className="h-4 w-4" />
                      </ResultDownloadButton>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </PatientLayout>
  );
}
