import { useEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePhysicianGetResultDownloadUrl,
  getPhysicianGetResultDownloadUrlQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import {
  CategoryBadge,
  EmptyState,
  Skeleton,
  StatusBadge,
  CATEGORY_LABELS,
} from "@/components/doctor/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, FileText, MessageSquare, Printer } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export type PreviewableResult = {
  id: number;
  category: string;
  originalFileName: string;
  fileType?: string;
  uploadedAt: string;
  status?: string;
  title?: string;
  summary?: string;
  findings?: string[];
  impression?: string;
  patientName?: string;
  patientHisId?: string;
  myReview?: {
    reviewed: boolean;
    reviewedAt?: string | null;
    comment?: string | null;
  };
};

export function toPreviewableResult(result: {
  id: number;
  category?: string;
  originalFileName?: string;
  fileType?: string;
  uploadedAt?: string;
  status?: string;
  title?: string;
  summary?: string;
  findings?: string[];
  impression?: string;
  patientName?: string | null;
  patientHisId?: string | null;
  myReview?: {
    reviewed?: boolean;
    reviewedAt?: string | null;
    comment?: string | null;
  } | null;
}): PreviewableResult {
  return {
    id: Number(result.id),
    category: String(result.category ?? "other"),
    originalFileName: String(result.originalFileName ?? "Result"),
    fileType: result.fileType ? String(result.fileType) : undefined,
    uploadedAt: String(result.uploadedAt ?? new Date().toISOString()),
    status: result.status ? String(result.status) : "released",
    title: result.title ? String(result.title) : undefined,
    summary: result.summary ? String(result.summary) : undefined,
    findings: Array.isArray(result.findings) ? result.findings.map(String) : undefined,
    impression: result.impression ? String(result.impression) : undefined,
    patientName: result.patientName ? String(result.patientName) : undefined,
    patientHisId: result.patientHisId ? String(result.patientHisId) : undefined,
    myReview: result.myReview
      ? {
          reviewed: Boolean(result.myReview.reviewed),
          reviewedAt: result.myReview.reviewedAt ?? null,
          comment: result.myReview.comment ?? null,
        }
      : undefined,
  };
}

export type ResultReviewState = NonNullable<PreviewableResult["myReview"]>;

function formatReviewedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function formatUploadStamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Saves physician review/comment via PUT /api/results/:id/review.
 * Staff Desk Recent Activity picks this up as “Comment” / “left a comment”.
 */
export function ResultCommentDialog({
  resultId,
  myReview,
  open,
  onOpenChange,
  onSaved,
  fileLabel,
}: {
  resultId: number;
  myReview?: PreviewableResult["myReview"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (review: ResultReviewState) => void;
  fileLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [shareWithPatient, setShareWithPatient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setComment(myReview?.comment ?? "");
    setShareWithPatient(false);
    setError(null);
  }, [open, resultId, myReview?.comment]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = await customFetch<{
        reviewed: boolean;
        reviewedAt: string | null;
        comment: string | null;
        patientVisible?: boolean;
      }>(`/api/results/${resultId}/review`, {
        method: "PUT",
        body: JSON.stringify({ comment, shareWithPatient }),
      });
      const review: ResultReviewState = {
        reviewed: true,
        reviewedAt: body.reviewedAt,
        comment: body.comment,
      };
      onSaved?.(review);
      void queryClient.invalidateQueries({ queryKey: ["/api/physician"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/results"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this review");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="doctor-shell max-w-md rounded-2xl border-[hsl(var(--doc-border))] bg-white sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[hsl(var(--doc-heading))]">Comment on result</DialogTitle>
          <DialogDescription className="doc-muted">
            {fileLabel
              ? `Your comment is saved to this result and appears on Staff Desk for ${fileLabel}.`
              : "Your comment is saved to this result and appears on the Staff Desk activity feed."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label
            className="block text-xs font-medium text-[hsl(var(--doc-text))]"
            htmlFor={`review-comment-${resultId}`}
          >
            Comment
          </label>
          <textarea
            id={`review-comment-${resultId}`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={4}
            className="w-full rounded-xl border border-[hsl(var(--doc-border))] bg-white px-3 py-2 text-sm text-[hsl(var(--doc-text))] outline-none focus:border-[hsl(var(--doc-green))]"
            placeholder="Add your clinical comment for Staff Desk…"
          />
          {myReview?.reviewed ? (
            <p className="text-[11px] doc-muted">
              Previously reviewed
              {myReview.reviewedAt ? ` · ${formatReviewedAt(myReview.reviewedAt)}` : ""}.
              Saving updates your review.
            </p>
          ) : null}
          <label className="flex items-start gap-2 rounded-xl border border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-cream))] px-3 py-2.5 text-[12px] text-[hsl(var(--doc-text))]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={shareWithPatient}
              onChange={(event) => setShareWithPatient(event.target.checked)}
            />
            <span>
              <span className="font-semibold">Share this comment with the patient</span>
              <span className="mt-0.5 block doc-muted">
                Off by default. When enabled, the comment appears in the patient&apos;s Messages.
                Internal notes stay private unless you share them.
              </span>
            </span>
          </label>
          {error ? <p className="text-xs text-[hsl(var(--doc-maroon))]">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving}
            className="rounded-xl bg-[hsl(var(--doc-blue))] text-white hover:opacity-95"
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : "Save comment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultReviewControls({
  myReview,
  onOpenComment,
}: {
  resultId: number;
  myReview?: PreviewableResult["myReview"];
  onOpenComment: () => void;
}) {
  const reviewed = myReview?.reviewed === true;

  if (myReview == null) {
    return (
      <div className="flex-shrink-0 border-b border-[hsl(var(--doc-border))] px-3 py-3 sm:px-4">
        <p className="text-xs doc-muted">
          Review status is unavailable until physician review storage is installed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 border-b border-[hsl(var(--doc-border))] px-3 py-3 sm:px-4">
      {reviewed ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[hsl(var(--doc-green))]">Reviewed</p>
          {myReview.reviewedAt ? (
            <p className="text-xs doc-muted">Reviewed at: {formatReviewedAt(myReview.reviewedAt)}</p>
          ) : null}
          {myReview.comment ? (
            <p className="text-xs text-[hsl(var(--doc-text))]">Comment: {myReview.comment}</p>
          ) : null}
          <button
            type="button"
            onClick={onOpenComment}
            className="text-xs font-semibold text-[hsl(var(--doc-green))] hover:underline"
          >
            Update comment
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-amber-700">Pending Review</p>
          <button
            type="button"
            onClick={onOpenComment}
            className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700"
          >
            Comment / Mark reviewed
          </button>
        </div>
      )}
    </div>
  );
}

export function DocumentPreviewPane({
  result,
  patientName,
  variant = "default",
  onCommentClick,
  commentOpen,
  onCommentOpenChange,
  onReviewSaved,
  localReview,
  /** When true, parent owns ResultCommentDialog — pane only triggers onCommentClick. */
  externalComment = false,
}: {
  result?: PreviewableResult | null;
  patientName?: string;
  /** profile / results = Patient Profile or Patient Results reference layouts */
  variant?: "default" | "profile" | "results";
  onCommentClick?: () => void;
  commentOpen?: boolean;
  onCommentOpenChange?: (open: boolean) => void;
  onReviewSaved?: (review: ResultReviewState) => void;
  localReview?: ResultReviewState | null;
  externalComment?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [internalCommentOpen, setInternalCommentOpen] = useState(false);
  const [inlineSaved, setInlineSaved] = useState<ResultReviewState | null>(null);

  useEffect(() => {
    setInlineSaved(null);
  }, [result?.id]);

  if (!result) {
    return (
      <div className="doc-card flex h-full min-h-0 flex-col rounded-2xl">
        <div className="border-b border-[hsl(var(--doc-border))] px-4 py-3">
          <p className="text-sm font-semibold text-[hsl(var(--doc-text))]">
            {variant === "results" ? "Result Document" : "Document preview"}
          </p>
          <p className="text-xs doc-muted">Select a result to preview it here</p>
        </div>
        <EmptyState
          icon={FileText}
          title="No document selected"
          description="Choose a result from the list to preview the attached file on this page."
        />
      </div>
    );
  }

  const subject = patientName ?? result.patientName ?? "Patient";
  const review = localReview ?? inlineSaved ?? result.myReview;
  const dialogOpen = externalComment ? false : (commentOpen ?? internalCommentOpen);
  const setDialogOpen = onCommentOpenChange ?? setInternalCommentOpen;
  const openComment =
    onCommentClick ??
    (() => {
      if (!externalComment) setDialogOpen(true);
    });

  const handlePrint = () => {
    setPrinting(true);
    const printed = printPreview({
      iframe: iframeRef.current,
      liveUrl,
      result,
      patientName: subject,
    });
    window.setTimeout(() => setPrinting(false), printed ? 800 : 200);
  };

  const handleDownload = () => {
    if (!liveUrl) return;
    const a = document.createElement("a");
    a.href = liveUrl.replace(/([?&])inline=1(&)?/, (_, p1, p2) => (p2 ? p1 : "")).replace(/\?$/, "");
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.download = result.originalFileName;
    a.click();
  };

  const studyTitle =
    result.title ?? `${CATEGORY_LABELS[result.category] ?? result.category} Result`;

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 rounded-xl"
        disabled={!liveUrl}
        onClick={handleDownload}
      >
        <Download className="h-4 w-4" />
        Download
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 rounded-xl"
        disabled={printing}
        onClick={handlePrint}
      >
        <Printer className="h-4 w-4" />
        {printing ? "Printing…" : "Print"}
      </Button>
      <Button
        type="button"
        size="sm"
        className="h-9 gap-1.5 rounded-xl bg-[hsl(222_47%_20%)] text-white hover:opacity-95"
        onClick={openComment}
      >
        <MessageSquare className="h-4 w-4" />
        Comment
      </Button>
    </div>
  );

  return (
    <div className="doc-card flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      {variant === "results" ? (
        <div className="flex flex-shrink-0 flex-col gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
                <FileText className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-[hsl(var(--doc-text))]">Result Document</h2>
            </div>
            {actionButtons}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-[hsl(var(--doc-text))]">
                {result.originalFileName}
              </p>
              <StatusBadge status={result.status ?? "released"} />
            </div>
            <p className="mt-0.5 text-xs doc-muted">
              {studyTitle} · {formatUploadStamp(result.uploadedAt)}
            </p>
            {review?.reviewed && review.comment ? (
              <p className="mt-1 line-clamp-2 text-xs text-[hsl(var(--doc-text))]">
                Your comment: {review.comment}
              </p>
            ) : null}
          </div>
        </div>
      ) : variant === "profile" ? (
        <div className="flex flex-shrink-0 flex-col gap-3 border-b border-[hsl(var(--doc-border))] px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[hsl(var(--doc-text))]">{studyTitle}</p>
                <StatusBadge status={result.status ?? "released"} />
              </div>
              <p className="mt-0.5 truncate text-xs doc-muted">{result.originalFileName}</p>
              <p className="mt-0.5 text-[11px] doc-muted">
                Uploaded: {formatUploadStamp(result.uploadedAt)}
              </p>
              {review?.reviewed && review.comment ? (
                <p className="mt-1 line-clamp-2 text-xs text-[hsl(var(--doc-text))]">
                  Your comment: {review.comment}
                </p>
              ) : null}
            </div>
          </div>
          {actionButtons}
        </div>
      ) : (
        <>
          <div className="flex flex-shrink-0 items-start justify-between gap-2 border-b border-[hsl(var(--doc-border))] px-3 py-3 sm:px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[hsl(var(--doc-text))]">
                {result.title ?? result.originalFileName}
              </p>
              <p className="truncate text-xs doc-muted">{result.originalFileName}</p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <span className="hidden sm:inline-flex">
                <CategoryBadge category={result.category} />
              </span>
              <button
                type="button"
                onClick={handlePrint}
                disabled={printing}
                aria-label={`Print ${result.originalFileName}`}
                title="Print this preview"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-card))] px-2 text-[hsl(var(--doc-text))] transition-colors hover:border-[hsl(var(--doc-green))] hover:text-[hsl(var(--doc-green))] disabled:opacity-60 sm:px-2.5"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden text-xs font-medium sm:inline">
                  {printing ? "Printing…" : "Print"}
                </span>
              </button>
            </div>
          </div>
          <ResultReviewControls
            resultId={result.id}
            myReview={review}
            onOpenComment={openComment}
          />
        </>
      )}

      <div className="min-h-0 flex-1 bg-[#2f343a]">
        <LiveDocumentFrame
          resultId={result.id}
          result={result}
          patientName={subject}
          iframeRef={iframeRef}
          onSourceChange={setLiveUrl}
        />
      </div>

      {!externalComment ? (
        <ResultCommentDialog
          resultId={result.id}
          myReview={review}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          fileLabel={result.originalFileName}
          onSaved={(next) => {
            setInlineSaved(next);
            onReviewSaved?.(next);
          }}
        />
      ) : null}
    </div>
  );
}

function withInline(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}inline=1`;
}

function LiveDocumentFrame({
  resultId,
  result,
  patientName,
  iframeRef,
  onSourceChange,
}: {
  resultId: number;
  result: PreviewableResult;
  patientName: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onSourceChange: (url: string | null) => void;
}) {
  const { data, isFetching, isError } = usePhysicianGetResultDownloadUrl(resultId, {
    query: {
      enabled: !!resultId,
      queryKey: getPhysicianGetResultDownloadUrlQueryKey(resultId),
    },
  });

  useEffect(() => {
    onSourceChange(data?.url ? withInline(data.url) : null);
    return () => onSourceChange(null);
  }, [data?.url, onSourceChange]);

  if (isFetching) {
    return (
      <div className="h-full p-4 space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-full" />
      </div>
    );
  }

  if (data?.url) {
    return (
      <iframe
        ref={iframeRef}
        src={withInline(data.url)}
        title={`Preview of ${result.originalFileName}`}
        className="w-full h-full border-0 bg-white"
      />
    );
  }

  return (
    <div className="h-full flex items-center justify-center p-4">
      <EmptyState
        icon={FileText}
        title={isError ? "Unable to load document" : "Document unavailable"}
        description={
          isError
            ? "You may not have access to this file, or it could not be retrieved."
            : "No file preview is available for this result."
        }
      />
    </div>
  );
}

function printPreview({
  iframe,
  liveUrl,
  result,
  patientName,
}: {
  iframe: HTMLIFrameElement | null;
  liveUrl: string | null;
  result: PreviewableResult;
  patientName: string;
}) {
  if (iframe?.contentWindow && iframe.getAttribute("src")) {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      return true;
    } catch {
      // Cross-origin frames cannot be printed directly.
    }
  }

  if (liveUrl) {
    const popup = window.open(liveUrl, "_blank", "width=900,height=700");
    if (popup) {
      const tryPrint = () => {
        try {
          popup.focus();
          popup.print();
        } catch {
          // The browser still opened the file for manual print.
        }
      };
      popup.addEventListener("load", tryPrint);
      window.setTimeout(tryPrint, 600);
      return true;
    }
  }

  return printHtmlReport(result, patientName);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function printHtmlReport(result: PreviewableResult, patientName: string) {
  const findings = (result.findings ?? [])
    .map((finding) => `<li>${escapeHtml(finding)}</li>`)
    .join("");
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return false;
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(result.title ?? result.originalFileName)}</title>
  <style>
    @page { margin: 16mm; }
    body { font-family: Segoe UI, system-ui, sans-serif; color: #0f172a; margin: 0; }
    header { display: flex; justify-content: space-between; border-bottom: 3px solid #2f9e63; padding-bottom: 12px; margin-bottom: 18px; }
    .brand { letter-spacing: 0.18em; font-size: 11px; font-weight: 700; color: #9b3b4a; }
    h1 { font-size: 20px; margin: 4px 0 0; }
    .meta { color: #64748b; font-size: 12px; }
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 13px; margin: 0 0 16px; }
    dt { color: #64748b; }
    dd { margin: 0; font-weight: 600; }
    ul { padding-left: 18px; }
    .impression { background: #e8f7ee; padding: 10px 12px; border-radius: 8px; }
    .impression span { display: block; color: #2f9e63; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="brand">ACE MEDICAL CENTER</div>
      <h1>Diagnostic Report</h1>
      <div class="meta">Cebu · Confidential clinical document</div>
    </div>
    <div class="meta">${escapeHtml(new Date(result.uploadedAt).toLocaleDateString("en-PH"))}</div>
  </header>
  <dl>
    <div><dt>Patient</dt><dd>${escapeHtml(patientName)}</dd></div>
    <div><dt>HIS ID</dt><dd>${escapeHtml(result.patientHisId ?? "—")}</dd></div>
    <div><dt>Study</dt><dd>${escapeHtml(result.title ?? result.originalFileName)}</dd></div>
    <div><dt>File</dt><dd>${escapeHtml(result.originalFileName)}</dd></div>
  </dl>
  <p>${escapeHtml(result.summary ?? "Attached diagnostic file previewed in the physician workspace.")}</p>
  ${findings ? `<h2 style="font-size:14px;color:#2f9e63;">Findings</h2><ul>${findings}</ul>` : ""}
  <div class="impression">
    <span>Impression</span>
    ${escapeHtml(result.impression ?? "Released result available for physician review.")}
  </div>
</body>
</html>`);
  doc.close();

  const cleanup = () => frame.remove();
  win.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    win.focus();
    win.print();
    window.setTimeout(cleanup, 1500);
  }, 200);
  return true;
}

export function useSelectedResult<T extends { id: number }>(results: T[]) {
  const [selectedId, setSelectedId] = useState<number | null>(results[0]?.id ?? null);

  useEffect(() => {
    if (!results.length) {
      setSelectedId(null);
      return;
    }
    if (!results.some((result) => result.id === selectedId)) {
      setSelectedId(results[0].id);
    }
  }, [results, selectedId]);

  return {
    selectedId,
    setSelectedId,
    selected: results.find((result) => result.id === selectedId) ?? results[0] ?? null,
  };
}

export function ResultPreviewSheet({
  open,
  onOpenChange,
  result,
  patientName,
  variant = "default",
  onReviewSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result?: PreviewableResult | null;
  patientName?: string;
  variant?: "default" | "profile" | "results";
  onReviewSaved?: (review: ResultReviewState) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="doctor-shell h-[92vh] max-h-[92vh] p-0 border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-bg))] rounded-t-2xl flex flex-col gap-0"
      >
        <SheetTitle className="sr-only">{result?.originalFileName ?? "Result preview"}</SheetTitle>
        <div className="flex-1 min-h-0 p-3 pt-8">
          <DocumentPreviewPane
            result={result}
            patientName={patientName}
            variant={variant}
            onReviewSaved={onReviewSaved}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
