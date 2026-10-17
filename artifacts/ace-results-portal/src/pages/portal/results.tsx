import { useMemo, useState } from "react";
import { Redirect, useSearch } from "wouter";
import {
  getGetPortalResultsQueryKey,
  getPortalResultDownloadUrl,
  useGetPortalResults,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { PatientLayout } from "@/components/layout/patient-layout";
import { DepartmentFilter } from "@/components/portal/department-filter";
import { PortalResultsUnlockDialog } from "@/components/portal/results-unlock-dialog";
import {
  beginPortalResultDownload,
  endPortalResultDownload,
  getStoredPortalResultAccessCode,
  unlockPortalResult,
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
import { Download, Eye, FileText, Lock } from "lucide-react";

export default function PortalResultsPage() {
  const { portalAuth } = useAuth();
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
  const [unlockResultId, setUnlockResultId] = useState<number | null>(null);
  const [unlockedResultIds, setUnlockedResultIds] = useState<Set<number>>(() => new Set());

  const resultsQuery = useGetPortalResults({
    query: {
      queryKey: getGetPortalResultsQueryKey(),
      enabled: Boolean(portalAuth.token),
      retry: false,
    },
  });

  const unlockOpen = unlockResultId != null;

  async function openUnlockedDocument(result: {
    id: number;
    originalFileName: string;
    fileType: string;
    category: string;
  }) {
    beginPortalResultDownload(result.id);
    try {
      const data = await getPortalResultDownloadUrl(result.id);
      if (!data?.url) {
        toast({
          title: "Document unavailable",
          description: "The authorized file could not be opened.",
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
    }
  }

  function openUnlockFor(resultId: number) {
    setUnlockResultId(resultId);
    setUnlockError(null);
    setRequestMessage(null);
  }

  function isResultUnlocked(resultId: number): boolean {
    return unlockedResultIds.has(resultId) || Boolean(getStoredPortalResultAccessCode(resultId));
  }

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
    const target = (resultsQuery.data ?? []).find((row) => row.id === unlockResultId);
    setUnlockedResultIds((prev) => new Set(prev).add(unlockResultId));
    setUnlockResultId(null);
    if (target) void openUnlockedDocument(target);
  }

  function handleCloseUnlock() {
    setUnlockResultId(null);
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

  const unlockDocumentTitle =
    unlockResultId != null
      ? (() => {
          const row = (resultsQuery.data ?? []).find((r) => r.id === unlockResultId);
          return row
            ? `${resultCategoryLabel(row.category)} · ${row.originalFileName}`
            : null;
        })()
      : null;

  if (!portalAuth.patient || !portalAuth.token) {
    return <Redirect to="/login" />;
  }

  return (
    <PatientLayout title="RESULTS">
      <PortalResultsUnlockDialog
        open={unlockOpen}
        busy={unlockBusy}
        error={unlockError}
        requestBusy={requestBusy}
        requestMessage={requestMessage}
        documentTitle={unlockDocumentTitle}
        onSubmit={(code) => void handleUnlock(code)}
        onClose={handleCloseUnlock}
        onRequestAccessCode={() => void handleRequestAccessCode()}
      />
      {viewer ? (
        <ResultFileViewer
          viewer={viewer}
          onClose={() => setViewer(null)}
          onBackToResults={() => setViewer(null)}
        />
      ) : null}

      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#17221D]">My diagnostic results</h2>
            <p className="text-sm text-[#64706A]">
              Released results from ACE Medical Center Cebu. Each document has its own access code.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DepartmentFilter value={category} onChange={setCategory} />
          </div>
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
              const unlocked = isResultUnlocked(result.id);
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
                      {!unlocked ? (
                        <button
                          type="button"
                          onClick={() => openUnlockFor(result.id)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[#FBECEF] px-3 py-2 text-[12px] font-semibold text-[#A20F2F] sm:flex-none"
                        >
                          <Lock className="h-4 w-4" />
                          Locked — Unlock to view
                        </button>
                      ) : (
                        <>
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
                        </>
                      )}
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
