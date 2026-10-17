import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  getGetPortalResultDownloadUrlQueryKey,
  getPortalResultDownloadUrl,
  useGetPortalResultDownloadUrl,
  type PortalResult,
} from "@workspace/api-client-react";
import {
  beginPortalResultDownload,
  endPortalResultDownload,
} from "@/lib/portal-results-access";
import { ArrowLeft, Download, ExternalLink, FileWarning, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";

export type ResultViewerState = {
  url: string;
  fileType: string;
  fileName: string;
  title?: string;
  meta?: string;
};

export function ResultFileViewer({
  viewer,
  onClose,
  onBackToResults,
}: {
  viewer: ResultViewerState;
  onClose: () => void;
  onBackToResults?: () => void;
}) {
  const isImage = viewer.fileType === "jpeg" || viewer.fileType === "png";
  const isPdf = viewer.fileType === "pdf";
  const [zoom, setZoom] = useState(100);
  const [frameError, setFrameError] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setZoom(100);
    setFrameError(false);
    setLoadError(null);
    let cancelled = false;
    // Probe a few bytes so JSON 404s are not shown inside the PDF iframe.
    void (async () => {
      try {
        const res = await fetch(viewer.url, {
          method: "GET",
          credentials: "include",
          headers: { Range: "bytes=0-63" },
        });
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        if (!res.ok || contentType.includes("application/json")) {
          let message = "Document file was not found on the server.";
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) message = body.error;
          } catch {
            /* ignore parse errors */
          }
          if (!cancelled) setLoadError(message);
        }
      } catch {
        if (!cancelled) setLoadError("Unable to reach the document server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewer.url]);

  const pdfSrc =
    isPdf && !frameError
      ? `${viewer.url}#toolbar=1&navpanes=0&zoom=${encodeURIComponent(String(zoom))}`
      : viewer.url;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0B1A14]/92"
      role="dialog"
      aria-modal="true"
      aria-label={viewer.title ?? viewer.fileName}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0B1A14]/80 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {onBackToResults ? (
            <button
              type="button"
              onClick={onBackToResults}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/20"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Results
            </button>
          ) : null}
          <div className="min-w-0 text-white">
            <p className="truncate text-sm font-medium">{viewer.title ?? viewer.fileName}</p>
            <p className="truncate text-xs text-white/60">
              {viewer.meta ? `${viewer.meta} · ` : ""}
              {viewer.fileType.toUpperCase()}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isPdf ? (
            <>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[3rem] text-center text-xs font-semibold text-white/80">{zoom}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(200, z + 25))}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
          <a
            href={viewer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </a>
          <a
            href={viewer.url}
            download={viewer.fileName}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <Download className="h-4 w-4" />
            Save
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            aria-label="Close document viewer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-3 sm:p-4">
        {loadError ? (
          <div className="max-w-md rounded-2xl border border-white/15 bg-white px-6 py-8 text-center shadow-2xl">
            <FileWarning className="mx-auto h-10 w-10 text-[#A20F2F]" />
            <p className="mt-3 text-base font-semibold text-[#101D3A]">Document unavailable</p>
            <p className="mt-1 text-sm text-[#687A93]">{loadError}</p>
            <p className="mt-2 text-xs text-[#687A93]">
              Ask hospital staff to re-upload the result if this keeps happening.
            </p>
          </div>
        ) : null}
        {!loadError && frameError && isPdf ? (
          <div className="max-w-md rounded-2xl border border-white/15 bg-white px-6 py-8 text-center shadow-2xl">
            <FileWarning className="mx-auto h-10 w-10 text-[#A20F2F]" />
            <p className="mt-3 text-base font-semibold text-[#101D3A]">Unable to display this document</p>
            <p className="mt-1 text-sm text-[#687A93]">
              The file could not be previewed in the portal. You can open it in a new tab if your browser supports it.
            </p>
            <a
              href={viewer.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex rounded-xl bg-[#07864B] px-4 py-2 text-sm font-semibold text-white"
            >
              Open in new tab
            </a>
          </div>
        ) : null}
        {!loadError && isImage ? (
          <img
            src={viewer.url}
            alt={viewer.fileName}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center center" }}
          />
        ) : null}
        {!loadError && isPdf && !frameError ? (
          <iframe
            src={pdfSrc}
            title={viewer.fileName}
            className="h-full w-full rounded-lg bg-white shadow-2xl"
            style={{ minHeight: "min(80vh, 720px)" }}
            onError={() => setFrameError(true)}
          />
        ) : null}
        {!isImage && !isPdf ? (
          <div className="max-w-md rounded-2xl border border-white/15 bg-white px-6 py-8 text-center shadow-2xl">
            <FileWarning className="mx-auto h-10 w-10 text-[#A20F2F]" />
            <p className="mt-3 text-base font-semibold text-[#101D3A]">Preview not available</p>
            <p className="mt-1 text-sm text-[#687A93]">
              This file type ({viewer.fileType}) cannot be previewed in the portal. Download or open it in a
              new tab if allowed.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <a
                href={viewer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-xl bg-[#07864B] px-4 py-2 text-sm font-semibold text-white"
              >
                Open file
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ResultViewButton({
  result,
  onView,
  className,
  children,
}: {
  result: Pick<PortalResult, "id" | "originalFileName" | "fileType">;
  onView: (viewer: ResultViewerState) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [viewEnabled, setViewEnabled] = useState(false);
  const { data: viewData, isFetching, isError } = useGetPortalResultDownloadUrl(result.id, {
    query: {
      enabled: viewEnabled,
      queryKey: [...getGetPortalResultDownloadUrlQueryKey(result.id), "view"],
      retry: false,
    },
  });

  useEffect(() => {
    if (viewData?.url && viewEnabled) {
      onView({
        url: viewData.url,
        fileType: result.fileType,
        fileName: result.originalFileName,
        title: result.originalFileName,
      });
      endPortalResultDownload();
      setViewEnabled(false);
    }
  }, [viewData?.url, viewEnabled, onView, result.fileType, result.originalFileName]);

  useEffect(() => {
    if (isError && viewEnabled) {
      endPortalResultDownload();
      setViewEnabled(false);
    }
  }, [isError, viewEnabled]);

  const opening = Boolean(isFetching && viewEnabled);

  return (
    <button
      type="button"
      onClick={() => {
        beginPortalResultDownload(result.id);
        setViewEnabled(true);
      }}
      disabled={opening}
      className={
        className ??
        "inline-flex rounded-md bg-[hsl(var(--pt-green))] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[hsl(var(--pt-rail))] disabled:opacity-70"
      }
    >
      {opening ? "Opening…" : (children ?? "View")}
    </button>
  );
}

/** Imperative helper for dashboard unlock-and-view flows. */
export function useOpenPortalResultDocument(
  result: Pick<PortalResult, "id" | "originalFileName" | "fileType" | "category"> | null | undefined,
  onView: (viewer: ResultViewerState) => void,
) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const open = useCallback(async () => {
    if (!result || opening) return;
    setOpening(true);
    setError(null);
    beginPortalResultDownload(result.id);
    try {
      const data = await getPortalResultDownloadUrl(result.id);
      if (!data?.url) throw new Error("Document URL unavailable");
      onView({
        url: data.url,
        fileType: result.fileType,
        fileName: result.originalFileName,
        title: result.originalFileName,
        meta: result.category,
      });
    } catch (err) {
      setError(err);
    } finally {
      endPortalResultDownload();
      setOpening(false);
    }
  }, [result, opening, onView]);

  return { open, opening, error };
}

export function ResultDocumentLoadingOverlay({ message }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-xl">
        <Loader2 className="h-5 w-5 animate-spin text-[#07864B]" />
        <p className="text-sm font-semibold text-[#101D3A]">{message ?? "Opening your document…"}</p>
      </div>
    </div>
  );
}

export function ResultDownloadButton({
  result,
  className,
  children,
}: {
  result: Pick<PortalResult, "id" | "originalFileName">;
  className?: string;
  children?: ReactNode;
}) {
  const [downloadEnabled, setDownloadEnabled] = useState(false);
  const { data, isFetching, isError } = useGetPortalResultDownloadUrl(result.id, {
    query: {
      enabled: downloadEnabled,
      queryKey: [...getGetPortalResultDownloadUrlQueryKey(result.id), "download"],
      retry: false,
    },
  });

  useEffect(() => {
    if (!data?.url || !downloadEnabled) return;
    const anchor = document.createElement("a");
    anchor.href = data.url;
    anchor.download = result.originalFileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    endPortalResultDownload();
    setDownloadEnabled(false);
  }, [data?.url, downloadEnabled, result.originalFileName]);

  useEffect(() => {
    if (isError && downloadEnabled) {
      endPortalResultDownload();
      setDownloadEnabled(false);
    }
  }, [isError, downloadEnabled]);

  const downloading = Boolean(isFetching && downloadEnabled);

  return (
    <button
      type="button"
      onClick={() => {
        beginPortalResultDownload(result.id);
        setDownloadEnabled(true);
      }}
      disabled={downloading}
      aria-label={`Download ${result.originalFileName}`}
      className={
        className ??
        "inline-flex items-center justify-center rounded-md border border-[#DDE5E0] px-3 py-2 text-[#17221D] disabled:opacity-70"
      }
    >
      {children ?? (downloading ? "…" : "Download")}
    </button>
  );
}
