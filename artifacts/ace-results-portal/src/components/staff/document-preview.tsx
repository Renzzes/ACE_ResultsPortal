import { useEffect, useState } from "react";
import { getResultDownloadUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StaffResultAssignmentControl } from "@/components/staff/result-assignment-control";
import { Archive, Download, FileText, Printer, Trash2, Unlock } from "lucide-react";

export type StaffPreviewResult = {
  id: number;
  originalFileName: string;
  fileType?: string;
  category?: string;
  status?: string;
  patientName?: string | null;
  patientHisId?: string | null;
  uploadedAt?: string;
  releaseOption?: string | null;
  uploadedByName?: string | null;
  dateReleased?: string | null;
  scheduledReleaseDate?: string | null;
  assignedPhysician?: { id: number; name: string } | null;
  assignedPhysicians?: Array<{ id: number; name: string }>;
  remarks?: string | null;
  reviews?: Array<{
    physicianId: number;
    physicianName: string;
    reviewed: boolean;
    reviewedAt?: string | null;
    comment?: string | null;
  }>;
};

function physicianReviewRows(result: StaffPreviewResult) {
  if (result.reviews == null) return null;
  const saved = new Map(result.reviews.map((review) => [review.physicianId, review]));
  const assigned = result.assignedPhysicians ?? [];
  if (assigned.length === 0) return result.reviews;
  return assigned.map((physician) => saved.get(physician.id) ?? {
    physicianId: physician.id,
    physicianName: physician.name,
    reviewed: false,
    reviewedAt: null,
    comment: null,
  });
}

function formatReviewStamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  released: "bg-green-100 text-green-800",
  archived: "bg-slate-100 text-slate-600",
};

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory", radiology: "Radiology", ultrasound: "Ultrasound",
  ct_scan: "CT Scan", mri: "MRI", ecg: "ECG", echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation", other: "Other Diagnostics",
};

function withInline(url: string) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}inline=1`;
}

export function StaffResultPreviewDialog({
  open,
  onOpenChange,
  result,
  onArchive,
  onRelease,
  onDelete,
  canArchive,
  canRelease,
  canDelete,
  canAssign,
  onAssignmentUpdated,
  archiving,
  releasing,
  deleting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: StaffPreviewResult | null;
  onArchive?: () => void;
  onRelease?: () => void;
  onDelete?: () => void;
  canArchive?: boolean;
  canRelease?: boolean;
  canDelete?: boolean;
  canAssign?: boolean;
  onAssignmentUpdated?: (next: Array<{ id: number; name: string }>) => void;
  archiving?: boolean;
  releasing?: boolean;
  deleting?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="staff-shell max-w-5xl w-[min(96vw,72rem)] h-[min(92vh,52rem)] p-0 overflow-hidden gap-0 bg-[hsl(var(--st-card))] border-[hsl(var(--st-border))] sm:rounded-2xl flex flex-col [&>button]:right-3 [&>button]:top-3 [&>button]:z-20 [&>button]:rounded-full [&>button]:bg-white/90 [&>button]:p-1.5 [&>button]:shadow-sm">
        <DialogHeader className="sr-only">
          <DialogTitle>{result?.originalFileName ?? "Result preview"}</DialogTitle>
          <DialogDescription>Secure in-page preview of the diagnostic file.</DialogDescription>
        </DialogHeader>
        <StaffResultPreviewPane
          result={result}
          onArchive={onArchive}
          onRelease={onRelease}
          onDelete={onDelete}
          canArchive={canArchive}
          canRelease={canRelease}
          canDelete={canDelete}
          canAssign={canAssign}
          onAssignmentUpdated={onAssignmentUpdated}
          archiving={archiving}
          releasing={releasing}
          deleting={deleting}
        />
      </DialogContent>
    </Dialog>
  );
}

export function StaffResultPreviewPane({
  result,
  onArchive,
  onRelease,
  onDelete,
  canArchive,
  canRelease,
  canDelete,
  canAssign,
  onAssignmentUpdated,
  archiving,
  releasing,
  deleting,
}: {
  result: StaffPreviewResult | null;
  onArchive?: () => void;
  onRelease?: () => void;
  onDelete?: () => void;
  canArchive?: boolean;
  canRelease?: boolean;
  canDelete?: boolean;
  canAssign?: boolean;
  onAssignmentUpdated?: (next: Array<{ id: number; name: string }>) => void;
  archiving?: boolean;
  releasing?: boolean;
  deleting?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!result?.id) {
      setPreviewUrl(null);
      setPreviewError(null);
      return;
    }
    setLoadingPreview(true);
    setPreviewError(null);
    setPreviewUrl(null);
    void getResultDownloadUrl(result.id)
      .then((data) => {
        if (cancelled) return;
        if (!data?.url) {
          setPreviewError("Preview link unavailable.");
          return;
        }
        setPreviewUrl(withInline(data.url));
      })
      .catch(() => {
        if (!cancelled) setPreviewError("You don't have permission to view this file.");
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => { cancelled = true; };
  }, [result?.id]);

  if (!result) return null;

  const handlePrint = () => {
    if (!previewUrl) return;
    const win = window.open(previewUrl, "_blank");
    if (win) win.focus();
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const data = await getResultDownloadUrl(result.id);
      if (!data?.url) return;
      const link = document.createElement("a");
      link.href = data.url;
      link.download = result.originalFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setDownloading(false);
    }
  };

  const fileType = (result.fileType ?? "").toLowerCase();
  const isImage = fileType === "jpeg" || fileType === "png" || fileType === "jpg";
  const isPdf = fileType === "pdf";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--st-border))] px-4 py-3 pr-14">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[hsl(var(--st-text))]">{result.originalFileName}</p>
          <p className="truncate text-xs st-muted">
            {[result.patientName, result.patientHisId].filter(Boolean).join(" · ") || "Diagnostic file"}
          </p>
          <p className="truncate text-xs st-muted mt-0.5">
            {[
              result.category ? (CATEGORY_LABELS[result.category] ?? result.category) : null,
              result.uploadedByName ? `Uploaded by ${result.uploadedByName}` : null,
              result.releaseOption ? `Release: ${result.releaseOption.replaceAll("_", " ")}` : null,
            ].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-1">
            <StaffResultAssignmentControl
              resultId={result.id}
              assignedPhysician={result.assignedPhysician}
              assignedPhysicians={result.assignedPhysicians}
              enabled={Boolean(canAssign)}
              onUpdated={onAssignmentUpdated}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {result.status ? (
            <span className={`text-xs font-medium px-2 py-1 rounded-full capitalize ${STATUS_CLASSES[result.status] ?? "bg-muted"}`}>
              {result.status}
            </span>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={handlePrint} disabled={!previewUrl} className="gap-1.5">
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void handleDownload()} disabled={downloading} className="gap-1.5">
            <Download className="h-4 w-4" />
            {downloading ? "Downloading…" : "Download"}
          </Button>
          {canRelease && result.status === "pending" && onRelease ? (
            <Button type="button" size="sm" variant="outline" onClick={onRelease} disabled={releasing} className="gap-1.5 text-green-700">
              <Unlock className="h-4 w-4" />
              {releasing ? "Releasing…" : "Release"}
            </Button>
          ) : null}
          {canArchive && result.status !== "archived" && onArchive ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onArchive}
              disabled={archiving}
              className="gap-1.5 text-[hsl(var(--st-maroon))]"
            >
              <Archive className="h-4 w-4" />
              Archive
            </Button>
          ) : null}
          {canDelete && onDelete ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onDelete}
              disabled={deleting}
              className="gap-1.5 text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="border-b border-[hsl(var(--st-border))] px-4 py-3 space-y-3 max-h-48 overflow-auto">
        {result.remarks ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Staff upload remark</p>
            <p className="mt-1 text-sm text-[hsl(var(--st-text))]">{result.remarks}</p>
          </div>
        ) : null}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Physician reviews</p>
          {(() => {
            const reviews = physicianReviewRows(result);
            if (reviews == null) {
              return <p className="mt-1 text-xs text-muted-foreground">Physician reviews are unavailable until review storage is installed.</p>;
            }
            if (reviews.length === 0) {
              return <p className="mt-1 text-xs text-muted-foreground">No physicians are assigned to this result.</p>;
            }
            return (
              <ul className="mt-2 space-y-2">
                {reviews.map((review) => (
                  <li key={review.physicianId}>
                    <p className="text-sm font-medium text-[hsl(var(--st-text))]">{review.physicianName}</p>
                    <p className={`text-xs ${review.reviewed ? "text-green-700" : "text-muted-foreground"}`}>
                      {review.reviewed ? "Reviewed" : "Not reviewed"}
                    </p>
                    {review.reviewed && review.reviewedAt ? (
                      <p className="text-xs text-muted-foreground">{formatReviewStamp(review.reviewedAt)}</p>
                    ) : null}
                    {review.comment ? (
                      <p className="text-xs text-[hsl(var(--st-text))]">&ldquo;{review.comment}&rdquo;</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-[hsl(var(--st-cream))] p-3">
        {loadingPreview ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading preview…</div>
        ) : previewError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-8 w-8 opacity-40" />
            <p>{previewError}</p>
            <Button size="sm" variant="outline" onClick={() => void handleDownload()}>Download instead</Button>
          </div>
        ) : previewUrl && isPdf ? (
          <iframe title={result.originalFileName} src={previewUrl} className="h-full w-full rounded-lg bg-white border border-[hsl(var(--st-border))]" />
        ) : previewUrl && isImage ? (
          <div className="h-full overflow-auto flex items-start justify-center">
            <img src={previewUrl} alt={result.originalFileName} className="max-w-full h-auto rounded-lg shadow-sm bg-white" />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-8 w-8 opacity-40" />
            <p>Preview is not available for this file type.</p>
            <Button size="sm" variant="outline" onClick={() => void handleDownload()}>Download</Button>
          </div>
        )}
      </div>
    </div>
  );
}
