import { useEffect, useState, type ReactNode } from "react";
import {
  getGetPortalResultDownloadUrlQueryKey,
  useGetPortalResultDownloadUrl,
  type PortalResult,
} from "@workspace/api-client-react";
import { Download, X } from "lucide-react";

export type ResultViewerState = {
  url: string;
  fileType: string;
  fileName: string;
};

export function ResultFileViewer({
  viewer,
  onClose,
}: {
  viewer: ResultViewerState;
  onClose: () => void;
}) {
  const isImage = viewer.fileType === "jpeg" || viewer.fileType === "png";
  const isPdf = viewer.fileType === "pdf";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-black/60 px-4 py-3">
        <div className="min-w-0 text-white">
          <p className="truncate text-sm font-medium">{viewer.fileName}</p>
          <p className="text-xs uppercase text-white/60">{viewer.fileType}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={viewer.url}
            download={viewer.fileName}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <Download className="h-4 w-4" />
            Save
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {isImage && (
          <img
            src={viewer.url}
            alt={viewer.fileName}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        )}
        {isPdf && (
          <iframe
            src={viewer.url}
            title={viewer.fileName}
            className="h-full w-full rounded-lg bg-white shadow-2xl"
            style={{ minHeight: "80vh" }}
          />
        )}
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
      });
      setViewEnabled(false);
    }
  }, [viewData?.url, viewEnabled, onView, result.fileType, result.originalFileName]);

  useEffect(() => {
    if (isError && viewEnabled) setViewEnabled(false);
  }, [isError, viewEnabled]);

  const opening = Boolean(isFetching && viewEnabled);

  return (
    <button
      type="button"
      onClick={() => setViewEnabled(true)}
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
    setDownloadEnabled(false);
  }, [data?.url, downloadEnabled, result.originalFileName]);

  useEffect(() => {
    if (isError && downloadEnabled) setDownloadEnabled(false);
  }, [isError, downloadEnabled]);

  const downloading = Boolean(isFetching && downloadEnabled);

  return (
    <button
      type="button"
      onClick={() => setDownloadEnabled(true)}
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
