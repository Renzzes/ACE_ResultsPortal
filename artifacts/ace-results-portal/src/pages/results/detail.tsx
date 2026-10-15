import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  useGetResult,
  getGetResultQueryKey,
  useGetPatient,
  getGetPatientQueryKey,
  useUpdateResult,
  useReleaseResult,
  useDeleteResult,
  getResultDownloadUrl,
  getListArchivedResultsQueryKey,
  getGetDashboardStatsQueryKey,
  getListResultsQueryKey,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  canArchiveResultsUi,
  canDeleteResultsUi,
  canReleaseResultsUi,
  canUploadResultsUi,
} from "@/lib/staff-permissions";
import { StaffResultAssignmentControl } from "@/components/staff/result-assignment-control";
import {
  Archive,
  ArrowLeft,
  ClipboardList,
  Download,
  FileText,
  MoreVertical,
  Printer,
  Trash2,
  Unlock,
} from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory",
  radiology: "Radiology",
  ultrasound: "Ultrasound",
  ct_scan: "CT Scan",
  mri: "MRI",
  ecg: "ECG",
  echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation",
  other: "Other Diagnostics",
};

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  released: "bg-emerald-100 text-emerald-800",
  archived: "bg-slate-100 text-slate-600",
};

type DetailTab = "document" | "details";

function withInline(url: string) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}inline=1`;
}

function ageFromDob(dob?: string | null): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
  return Math.max(0, age);
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? parts[parts.length - 1]?.[0] ?? "";
  return `${a}${b}`.toUpperCase() || "?";
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--st-border))] py-2 last:border-b-0">
      <dt className="text-xs font-medium text-[hsl(var(--st-muted))]">{label}</dt>
      <dd className="max-w-[65%] text-right text-sm font-semibold text-[hsl(var(--st-text))] break-words">
        {value}
      </dd>
    </div>
  );
}

export default function ResultDetailPage() {
  const [, params] = useRoute("/results/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const resultId = parseInt(params?.id ?? "0", 10);
  const role = auth.user?.role;
  const canArchive = canArchiveResultsUi(role);
  const canRelease = canReleaseResultsUi(role);
  const canDelete = canDeleteResultsUi(role);
  const canUpload = canUploadResultsUi(role);

  const [tab, setTab] = useState<DetailTab>("document");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: result, isLoading, isError, refetch } = useGetResult(resultId, {
    query: { enabled: !!resultId, queryKey: getGetResultQueryKey(resultId) },
  });

  const patientId = result?.patientId ?? 0;
  const { data: patient } = useGetPatient(patientId, {
    query: { enabled: !!patientId, queryKey: getGetPatientQueryKey(patientId) },
  });

  const archiveResult = useUpdateResult();
  const releaseResult = useReleaseResult();
  const deleteResult = useDeleteResult();

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
    return () => {
      cancelled = true;
    };
  }, [result?.id]);

  const studyTitle = useMemo(() => {
    if (!result) return "Result";
    const category = CATEGORY_LABELS[result.category] ?? result.category;
    const remark = result.remarks?.trim();
    if (remark) return `${category.toUpperCase()} — ${remark}`;
    const base = result.originalFileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    return base ? `${category.toUpperCase()} — ${base}` : category.toUpperCase();
  }, [result]);

  const assignedPhysicians = useMemo(() => {
    return (result?.assignedPhysicians ?? [])
      .filter((row): row is { id: number; name: string } => typeof row.id === "number" && typeof row.name === "string");
  }, [result?.assignedPhysicians]);

  const assignedPhysician = useMemo(() => {
    const single = result?.assignedPhysician;
    if (single && typeof single.id === "number" && typeof single.name === "string") {
      return { id: single.id, name: single.name };
    }
    return assignedPhysicians[0] ?? null;
  }, [result?.assignedPhysician, assignedPhysicians]);

  const reviews = useMemo(() => {
    if (!result || !Array.isArray(result.reviews)) return null;
    const normalized = result.reviews
      .filter((r): r is {
        physicianId: number;
        physicianName: string;
        reviewed: boolean;
        reviewedAt?: string | null;
        comment?: string | null;
      } => typeof r.physicianId === "number" && typeof r.physicianName === "string")
      .map((r) => ({
        physicianId: r.physicianId,
        physicianName: r.physicianName,
        reviewed: Boolean(r.reviewed),
        reviewedAt: r.reviewedAt ?? null,
        comment: r.comment ?? null,
      }));
    const saved = new Map(normalized.map((r) => [r.physicianId, r]));
    if (assignedPhysicians.length === 0) return normalized;
    return assignedPhysicians.map(
      (physician) =>
        saved.get(physician.id) ?? {
          physicianId: physician.id,
          physicianName: physician.name,
          reviewed: false,
          reviewedAt: null,
          comment: null,
        },
    );
  }, [result, assignedPhysicians]);

  const primaryReview = reviews?.find((r) => r.reviewed) ?? reviews?.[0] ?? null;
  const age = ageFromDob(patient?.dateOfBirth);
  const patientName =
    patient
      ? `${patient.lastName}, ${patient.firstName}${patient.middleName ? ` ${patient.middleName}` : ""}`
      : result?.patientName ?? "—";

  const fileType = (result?.fileType ?? "").toLowerCase();
  const isPdf = fileType === "pdf";
  const isImage = fileType === "jpeg" || fileType === "png" || fileType === "jpg";

  const handleDownload = async () => {
    if (!result) return;
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

  const handlePrint = () => {
    if (!previewUrl) return;
    const win = window.open(previewUrl, "_blank");
    if (win) win.focus();
  };

  const handleArchive = () => {
    if (!result) return;
    archiveResult.mutate(
      { id: result.id, data: { status: "archived" } },
      {
        onSuccess: () => {
          toast({ title: "Result archived" });
          void refetch();
          void queryClient.invalidateQueries({ queryKey: getListArchivedResultsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListResultsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
        },
        onError: () =>
          toast({ title: "You don't have permission to perform this action.", variant: "destructive" }),
      },
    );
  };

  const handleRelease = () => {
    if (!result) return;
    releaseResult.mutate(
      { id: result.id, data: { releaseOption: "immediate" } },
      {
        onSuccess: () => {
          toast({ title: "Result released" });
          void refetch();
        },
        onError: () =>
          toast({ title: "You don't have permission to perform this action.", variant: "destructive" }),
      },
    );
  };

  const handleDelete = () => {
    if (!result) return;
    deleteResult.mutate(
      { id: result.id },
      {
        onSuccess: () => {
          toast({ title: "Result deleted" });
          setDeleteOpen(false);
          setLocation("/results");
        },
        onError: () =>
          toast({ title: "You don't have permission to perform this action.", variant: "destructive" }),
      },
    );
  };

  if (isLoading) {
    return (
      <StaffLayout showSearch={false} fill>
        <div className="space-y-4 p-2">
          <div className="h-16 animate-pulse rounded-xl bg-[hsl(var(--st-green-soft))]" />
          <div className="h-[28rem] animate-pulse rounded-xl bg-[hsl(var(--st-green-soft))]/70" />
        </div>
      </StaffLayout>
    );
  }

  if (isError || !result) {
    return (
      <StaffLayout showSearch={false}>
        <div className="space-y-3 py-16 text-center">
          <p className="st-muted">Could not load this result.</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setLocation("/results")}>
              Back to Results
            </Button>
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </StaffLayout>
    );
  }

  const tabs: Array<{ id: DetailTab; label: string; icon: typeof FileText }> = [
    { id: "document", label: "Result Document", icon: FileText },
    { id: "details", label: "Details", icon: ClipboardList },
  ];

  return (
    <StaffLayout showSearch={false} fill>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1 h-8 px-2"
              onClick={() => setLocation("/results")}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to Results
            </Button>
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--st-maroon-soft))]">
                <FileText className="h-5 w-5 text-[hsl(var(--st-maroon))]" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-bold text-[hsl(var(--st-text))] sm:text-2xl">
                    {studyTitle}
                  </h1>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${
                      STATUS_CLASSES[result.status] ?? "bg-muted"
                    }`}
                  >
                    {result.status}
                  </span>
                </div>
                <p className="mt-1 text-sm st-muted">
                  {result.originalFileName} · Uploaded {formatDateTime(result.uploadedAt)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl border-[hsl(var(--st-border))] bg-white"
              onClick={() => void handleDownload()}
              disabled={downloading}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {downloading ? "Downloading…" : "Download"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl border-[hsl(var(--st-border))] bg-white"
              onClick={handlePrint}
              disabled={!previewUrl}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-xl border-[hsl(var(--st-border))] bg-white"
                  aria-label="More result actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="staff-shell">
                {canRelease && result.status === "pending" ? (
                  <DropdownMenuItem onClick={handleRelease}>
                    <Unlock className="mr-2 h-3.5 w-3.5" />
                    Release
                  </DropdownMenuItem>
                ) : null}
                {canArchive && result.status !== "archived" ? (
                  <DropdownMenuItem onClick={handleArchive}>
                    <Archive className="mr-2 h-3.5 w-3.5" />
                    Archive
                  </DropdownMenuItem>
                ) : null}
                {result.patientId ? (
                  <DropdownMenuItem onClick={() => setLocation(`/patients/${result.patientId}`)}>
                    Open patient record
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1 border-b border-[hsl(var(--st-border))]">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? "border-[hsl(var(--st-green))] text-[hsl(var(--st-green))]"
                    : "border-transparent text-[hsl(var(--st-text))] hover:text-[hsl(var(--st-green))]"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "document" ? (
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,1.7fr)_minmax(17rem,22rem)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
            <section className="st-card flex min-h-[min(52vh,28rem)] flex-col overflow-hidden rounded-2xl bg-[#1f2933] sm:min-h-[min(58vh,36rem)] lg:h-full lg:min-h-0">
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-white/80">
                <span>Document viewer</span>
                <span className="uppercase tracking-wide">{fileType || "file"}</span>
              </div>
              <div className="relative min-h-0 flex-1 bg-[#111827]">
                {loadingPreview ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                    Loading document…
                  </div>
                ) : previewError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-sm text-white/80">{previewError}</p>
                    <Button variant="outline" onClick={() => void handleDownload()}>
                      Download file
                    </Button>
                  </div>
                ) : previewUrl && isPdf ? (
                  <iframe
                    title={result.originalFileName}
                    src={previewUrl}
                    className="absolute inset-0 h-full w-full border-0 bg-white"
                  />
                ) : previewUrl && isImage ? (
                  <div className="absolute inset-0 flex items-center justify-center overflow-auto p-4">
                    <img
                      src={previewUrl}
                      alt={result.originalFileName}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-sm text-white/80">Inline preview is not available for this file type.</p>
                    <Button variant="outline" onClick={() => void handleDownload()}>
                      Download file
                    </Button>
                  </div>
                )}
              </div>
            </section>

            <div className="st-scroll flex min-h-0 flex-col gap-3 overflow-y-auto lg:h-full">
              <section className="st-card rounded-2xl p-4">
                <div className="mb-3">
                  <h2 className="text-sm font-bold text-[hsl(var(--st-text))]">Patient Information</h2>
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#D6EAF8] text-sm font-bold text-[#1A5276]">
                    {initials(patientName)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[hsl(var(--st-text))]">{patientName}</p>
                    <p className="font-mono text-xs text-[hsl(var(--st-green))]">
                      HIS ID: {result.patientHisId || patient?.patientHisId || "—"}
                    </p>
                    <p className="text-xs st-muted">{age != null ? `${age} yrs` : "—"}</p>
                  </div>
                </div>
                <dl>
                  <InfoRow label="Date of Birth" value={formatDate(patient?.dateOfBirth)} />
                  <InfoRow label="Mobile" value={patient?.mobileNumber || "—"} />
                  <InfoRow label="Email" value={patient?.email || "—"} />
                </dl>
              </section>

              <section className="st-card rounded-2xl p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-[hsl(var(--st-text))]">Result Information</h2>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                    {CATEGORY_LABELS[result.category] ?? result.category}
                  </span>
                </div>
                <dl>
                  <InfoRow label="Study / Description" value={studyTitle} />
                  <InfoRow label="Accession No." value="—" />
                  <InfoRow label="Date Performed" value="—" />
                  <InfoRow label="Date Uploaded" value={formatDateTime(result.uploadedAt)} />
                  <InfoRow label="Uploaded By" value={result.uploadedByName || "—"} />
                  <InfoRow
                    label="Status"
                    value={
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${
                          STATUS_CLASSES[result.status] ?? "bg-muted"
                        }`}
                      >
                        {result.status}
                      </span>
                    }
                  />
                </dl>
                <div className="mt-3 border-t border-[hsl(var(--st-border))] pt-3">
                  <StaffResultAssignmentControl
                    resultId={result.id}
                    assignedPhysician={assignedPhysician}
                    assignedPhysicians={assignedPhysicians}
                    enabled={canUpload}
                    onUpdated={() => void refetch()}
                  />
                </div>
              </section>

              <section className="st-card rounded-2xl p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-[hsl(var(--st-text))]">Doctor&apos;s Comment</h2>
                </div>
                {reviews == null ? (
                  <p className="text-sm st-muted">Physician reviews are unavailable until review storage is installed.</p>
                ) : !primaryReview ? (
                  <p className="text-sm st-muted">No physicians are assigned to this result.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[hsl(var(--st-green-soft))] text-xs font-bold text-[hsl(var(--st-green))]">
                        {initials(primaryReview.physicianName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[hsl(var(--st-text))]">
                          {primaryReview.physicianName}
                        </p>
                        <p className="text-xs st-muted">
                          {primaryReview.reviewed
                            ? formatDateTime(primaryReview.reviewedAt)
                            : "Not reviewed yet"}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl bg-[hsl(var(--st-cream))] px-3 py-3 text-sm text-[hsl(var(--st-text))]">
                      {primaryReview.comment?.trim()
                        ? primaryReview.comment
                        : primaryReview.reviewed
                          ? "Reviewed with no comment."
                          : "No doctor comment yet."}
                    </div>
                    {(reviews?.length ?? 0) > 1 ? (
                      <p className="text-xs st-muted">{reviews!.length} physician review records on this result.</p>
                    ) : null}
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="st-scroll min-h-0 flex-1 overflow-y-auto">
            <section className="st-card rounded-2xl p-5">
              <h2 className="mb-4 text-base font-bold text-[hsl(var(--st-text))]">Result Details</h2>
              <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                <InfoRow label="Result ID" value={result.id} />
                <InfoRow label="Patient ID" value={result.patientId} />
                <InfoRow label="HIS ID" value={result.patientHisId || "—"} />
                <InfoRow label="Patient" value={result.patientName || patientName} />
                <InfoRow label="Category" value={CATEGORY_LABELS[result.category] ?? result.category} />
                <InfoRow label="Status" value={result.status} />
                <InfoRow label="File name" value={result.originalFileName} />
                <InfoRow label="File type" value={(result.fileType || "—").toUpperCase()} />
                <InfoRow
                  label="File size"
                  value={
                    result.fileSizeBytes != null
                      ? `${(result.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`
                      : "—"
                  }
                />
                <InfoRow label="Release option" value={(result.releaseOption || "—").replaceAll("_", " ")} />
                <InfoRow label="Scheduled release" value={formatDateTime(result.scheduledReleaseDate)} />
                <InfoRow label="Date released" value={formatDateTime(result.dateReleased)} />
                <InfoRow label="Uploaded by" value={result.uploadedByName || "—"} />
                <InfoRow label="Uploaded at" value={formatDateTime(result.uploadedAt)} />
                <InfoRow label="Staff remark" value={result.remarks || "—"} />
                <InfoRow
                  label="Assigned physicians"
                  value={assignedPhysicians.map((p) => p.name).join(", ") || "—"}
                />
              </dl>
            </section>
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this result?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the result record and its stored file. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteResult.isPending}>
              {deleteResult.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StaffLayout>
  );
}
