import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import {
  useGetPatient,
  getGetPatientQueryKey,
  useListPatientResultsStaff,
  getListPatientResultsStaffQueryKey,
  useReleaseResult,
  useGetResultDownloadUrl,
  getGetResultDownloadUrlQueryKey,
  useUpdateResult,
  useUpdatePatient,
  getListArchivedResultsQueryKey,
  getGetDashboardStatsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  canEditPatientsUi,
  canRegenerateAccessCodeUi,
  canUploadResultFileUi,
  canUploadResultsUi,
  useDebouncedValue,
} from "@/lib/staff-permissions";
import { UploadResultDialog } from "@/components/staff/upload-result-dialog";
import { StaffResultPreviewDialog, type StaffPreviewResult } from "@/components/staff/document-preview";
import {
  ArrowLeft,
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  FileText,
  Filter,
  History,
  MessageSquare,
  MoreVertical,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Shield,
  Stethoscope,
  Upload,
  UserRound,
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

type DetailTab = "overview" | "results";

type ResultPhysician = {
  id: number;
  name: string;
};

type StaffResultRow = {
  id: number;
  originalFileName: string;
  fileType: string;
  category: string;
  status: string;
  uploadedAt: string;
  releaseOption?: string;
  uploadedByName?: string;
  dateReleased?: string | null;
  scheduledReleaseDate?: string | null;
  remarks?: string | null;
  assignedPhysicians?: ResultPhysician[];
  reviews?: Array<{
    physicianId: number;
    physicianName: string;
    reviewed: boolean;
    reviewedAt: string | null;
    comment: string | null;
  }>;
};

function ageFromDob(dob: string): number | null {
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
  return Math.max(0, age);
}

function initials(lastName: string, firstName: string) {
  return `${(firstName?.[0] ?? "").toUpperCase()}${(lastName?.[0] ?? "").toUpperCase()}` || "?";
}

function formatDob(dob: string) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso: string) {
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

function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function resultHasReview(r: StaffResultRow) {
  return Array.isArray(r.reviews) && r.reviews.some((rev) => rev.reviewed);
}

function primaryReview(r: StaffResultRow) {
  if (!Array.isArray(r.reviews)) return null;
  return r.reviews.find((rev) => rev.reviewed) ?? null;
}

function statusLabel(r: StaffResultRow) {
  if (r.status === "archived") return "Archived";
  if (r.status === "released") return "Released";
  if (resultHasReview(r)) return "Reviewed";
  return "Pending Review";
}

function statusBadgeClass(label: string) {
  if (label === "Pending Review") return "bg-amber-100 text-amber-800";
  if (label === "Reviewed") return "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))]";
  if (label === "Released") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-600";
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--st-border))] py-2.5 last:border-b-0">
      <dt className="text-xs font-medium text-[hsl(var(--st-muted))]">{label}</dt>
      <dd className="max-w-[60%] text-right text-sm font-semibold text-[hsl(var(--st-text))] break-words">
        {value}
      </dd>
    </div>
  );
}

function DownloadMenuItem({ resultId }: { resultId: number }) {
  const [enabled, setEnabled] = useState(false);
  const { data } = useGetResultDownloadUrl(resultId, {
    query: { enabled, queryKey: getGetResultDownloadUrlQueryKey(resultId) },
  });

  useEffect(() => {
    if (data?.url && enabled) {
      window.open(data.url, "_blank");
      setEnabled(false);
    }
  }, [data?.url, enabled]);

  return (
    <DropdownMenuItem onClick={() => setEnabled(true)}>
      Download file
    </DropdownMenuItem>
  );
}

export default function PatientDetailPage() {
  const [, params] = useRoute("/patients/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const [docRegen, setDocRegen] = useState<{ id: number; title: string; category: string } | null>(null);
  const [docRegenEmail, setDocRegenEmail] = useState("");
  const [docRegenPending, setDocRegenPending] = useState(false);
  const [docRegenError, setDocRegenError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [preview, setPreview] = useState<StaffPreviewResult | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [resultSearch, setResultSearch] = useState("");
  const debouncedResultSearch = useDebouncedValue(resultSearch, 250);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "reviewed" | "released" | "archived">("all");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [form, setForm] = useState({
    lastName: "",
    firstName: "",
    middleName: "",
    dateOfBirth: "",
    mobileNumber: "",
    email: "",
  });

  const patientId = parseInt(params?.id ?? "0", 10);
  const role = auth.user?.role;
  const canEditInfo = canEditPatientsUi(role);
  const canRegen = canRegenerateAccessCodeUi(role);
  const canMutateResults = canUploadResultsUi(role);
  const canUpload = canUploadResultFileUi(role, auth.user?.permissions);
  const { data: patient, isLoading, isError, refetch: refetchPatient } = useGetPatient(patientId, {
    query: { queryKey: getGetPatientQueryKey(patientId), enabled: !!patientId },
  });

  const { data: results, refetch: refetchResults } = useListPatientResultsStaff(patientId, {
    query: { queryKey: getListPatientResultsStaffQueryKey(patientId), enabled: !!patientId },
  });

  const releaseResult = useReleaseResult();
  const archiveResult = useUpdateResult();
  const updatePatient = useUpdatePatient();

  useEffect(() => {
    if (!patient) return;
    setForm({
      lastName: patient.lastName ?? "",
      firstName: patient.firstName ?? "",
      middleName: patient.middleName ?? "",
      dateOfBirth: String(patient.dateOfBirth ?? "").slice(0, 10),
      mobileNumber: patient.mobileNumber ?? "",
      email: patient.email ?? "",
    });
  }, [patient]);

  useEffect(() => {
    setPage(1);
  }, [debouncedResultSearch, statusFilter]);

  const resultList = useMemo(
    () => (Array.isArray(results) ? results : []) as StaffResultRow[],
    [results],
  );

  /** Distinct physicians assigned to this patient's result files (result_physicians). */
  const resultPhysicians = useMemo(() => {
    const map = new Map<number, { id: number; name: string; resultCount: number }>();
    for (const row of resultList) {
      const assigned = row.assignedPhysicians ?? [];
      for (const physician of assigned) {
        if (typeof physician.id !== "number" || !physician.name) continue;
        const existing = map.get(physician.id);
        if (existing) {
          existing.resultCount += 1;
        } else {
          map.set(physician.id, { id: physician.id, name: physician.name, resultCount: 1 });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [resultList]);

  const filteredResults = useMemo(() => {
    const q = debouncedResultSearch.trim().toLowerCase();
    return resultList.filter((r) => {
      const label = statusLabel(r);
      if (statusFilter === "pending" && label !== "Pending Review") return false;
      if (statusFilter === "reviewed" && label !== "Reviewed") return false;
      if (statusFilter === "released" && label !== "Released") return false;
      if (statusFilter === "archived" && label !== "Archived") return false;
      if (!q) return true;
      const hay = `${r.originalFileName} ${CATEGORY_LABELS[r.category] ?? r.category} ${r.remarks ?? ""} ${label}`.toLowerCase();
      return hay.includes(q);
    });
  }, [resultList, debouncedResultSearch, statusFilter]);

  async function handleDocumentRegen() {
    if (!docRegen) return;
    const email = (patient?.email?.trim() || docRegenEmail).trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setDocRegenError("Enter a valid recipient email.");
      return;
    }
    setDocRegenPending(true);
    setDocRegenError(null);
    try {
      await customFetch(`/api/results/${docRegen.id}/regenerate-access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      toast({
        title: "Document access code regenerated",
        description: "The new code was emailed to the patient. Other documents are unchanged.",
      });
      setDocRegen(null);
      void refetchResults();
    } catch (err) {
      setDocRegenError(err instanceof Error ? err.message : "Unable to regenerate access code.");
    } finally {
      setDocRegenPending(false);
    }
  }

  const handleRelease = (resultId: number) => {
    releaseResult.mutate(
      { id: resultId, data: { releaseOption: "immediate" } },
      {
        onSuccess: () => {
          toast({ title: "Result released" });
          void refetchResults();
        },
        onError: () =>
          toast({ title: "You don't have permission to perform this action.", variant: "destructive" }),
      },
    );
  };

  const handleArchive = (resultId: number) => {
    archiveResult.mutate(
      { id: resultId, data: { status: "archived" } },
      {
        onSuccess: () => {
          toast({ title: "Result archived" });
          void refetchResults();
          void queryClient.invalidateQueries({ queryKey: getListArchivedResultsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
        },
        onError: () =>
          toast({ title: "You don't have permission to perform this action.", variant: "destructive" }),
      },
    );
  };

  const handleSaveInfo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditInfo) return;
    updatePatient.mutate(
      {
        id: patientId,
        data: {
          lastName: form.lastName,
          firstName: form.firstName,
          middleName: form.middleName || null,
          dateOfBirth: form.dateOfBirth,
          mobileNumber: form.mobileNumber || null,
          email: form.email || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Patient details saved" });
          setEditOpen(false);
          void refetchPatient();
        },
        onError: () => {
          toast({
            title: "Could not save patient",
            description: "You don't have permission to perform this action.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const printPatientInfo = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <StaffLayout showSearch={false}>
        <div className="space-y-4">
          <div className="h-20 animate-pulse rounded-xl bg-[hsl(var(--st-green-soft))]" />
          <div className="h-48 animate-pulse rounded-xl bg-[hsl(var(--st-green-soft))]/70" />
        </div>
      </StaffLayout>
    );
  }

  if (isError) {
    return (
      <StaffLayout showSearch={false}>
        <div className="space-y-3 py-16 text-center">
          <p className="st-muted">Could not load this patient.</p>
          <Button variant="outline" onClick={() => void refetchPatient()}>
            Retry
          </Button>
        </div>
      </StaffLayout>
    );
  }

  if (!patient) {
    return (
      <StaffLayout showSearch={false}>
        <div className="py-16 text-center">Patient not found.</div>
      </StaffLayout>
    );
  }

  const pendingCount = resultList.filter((r) => r.status === "pending" && !resultHasReview(r)).length;
  const reviewedCount = resultList.filter((r) => r.status !== "archived" && resultHasReview(r) && r.status !== "released").length;
  const releasedCount = resultList.filter((r) => r.status === "released").length;
  const archivedCount = resultList.filter((r) => r.status === "archived").length;
  const age = ageFromDob(patient.dateOfBirth);
  const fullName = `${patient.lastName}, ${patient.firstName}${patient.middleName ? ` ${patient.middleName}` : ""}`;
  const portalActive = Boolean((patient as { portalActive?: boolean }).portalActive);

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredResults.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeStart = filteredResults.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, filteredResults.length);

  const openPreview = (r: StaffResultRow) => {
    setPreview({
      id: r.id,
      originalFileName: r.originalFileName,
      fileType: r.fileType,
      category: r.category,
      status: r.status,
      patientName: fullName,
      patientHisId: patient.patientHisId,
      uploadedAt: r.uploadedAt,
      releaseOption: r.releaseOption,
      uploadedByName: r.uploadedByName,
      dateReleased: r.dateReleased,
      scheduledReleaseDate: r.scheduledReleaseDate,
      remarks: r.remarks,
      reviews: r.reviews,
    });
  };

  const tabs: Array<{
    id: DetailTab | "history";
    label: string;
    icon: typeof FileText;
  }> = [
    { id: "overview", label: "Overview", icon: ClipboardList },
    { id: "results", label: "Results", icon: FileText },
    { id: "history", label: "Patient History", icon: History },
  ];

  const onTabClick = (id: (typeof tabs)[number]["id"]) => {
    if (id === "overview" || id === "results") {
      setTab(id);
      return;
    }
    if (id === "history") {
      setLocation(`/patients/history?search=${encodeURIComponent(patient.patientHisId)}`);
    }
  };

  return (
    <StaffLayout showSearch={false} fill>
      <div className="st-scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto pb-4">
        {/* Identity header */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1 h-8 px-2 text-[hsl(var(--st-text))]"
              onClick={() => setLocation("/patients")}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-[#D6EAF8] text-lg font-bold text-[#1A5276]">
                {initials(patient.lastName, patient.firstName)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-bold tracking-tight text-[hsl(var(--st-text))] sm:text-[1.75rem]">
                    {fullName}
                  </h1>
                  <span className="font-mono text-sm font-semibold text-[hsl(var(--st-muted))]">
                    HIS ID: {patient.patientHisId}
                  </span>
                  {portalActive ? (
                    <span className="rounded-full bg-[hsl(var(--st-green-soft))] px-2 py-0.5 text-[11px] font-bold text-[hsl(var(--st-green))]">
                      Portal Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-[hsl(var(--st-cream))] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--st-muted))]">
                      No Portal Account
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm st-muted">
                  {age != null ? `${age} yrs (${formatDob(patient.dateOfBirth)})` : formatDob(patient.dateOfBirth)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {canUpload ? (
              <Button
                type="button"
                className="h-10 rounded-xl bg-[hsl(var(--st-green))] px-4 text-white hover:opacity-95"
                onClick={() => setUploadOpen(true)}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Result
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-xl border-[hsl(var(--st-border))] bg-white"
                  aria-label="More patient actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="staff-shell">
                <DropdownMenuItem onClick={printPatientInfo}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print patient info
                </DropdownMenuItem>
                {canEditInfo ? (
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit information
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setLocation(`/results?search=${encodeURIComponent(patient.patientHisId)}`)}
                >
                  Open in Results
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-[hsl(var(--st-border))]">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabClick(t.id)}
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

        {(tab === "overview" || tab === "results") && (
          <>
            {tab === "overview" ? (
              <div className="grid items-stretch gap-3 xl:grid-cols-[1.25fr_1fr_1fr]">
                {/* Patient Information */}
                <section className="st-card h-full rounded-2xl p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--st-cream))]">
                        <UserRound className="h-4 w-4 text-[hsl(var(--st-muted))]" />
                      </span>
                      <h2 className="text-base font-bold text-[hsl(var(--st-text))]">Patient Information</h2>
                    </div>
                    {canEditInfo ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg border-[hsl(var(--st-border))] bg-white"
                        onClick={() => setEditOpen(true)}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    ) : null}
                  </div>
                  <dl>
                    <InfoRow label="HIS ID" value={<span className="font-mono">{patient.patientHisId}</span>} />
                    <InfoRow label="Last Name" value={patient.lastName || "—"} />
                    <InfoRow label="First Name" value={patient.firstName || "—"} />
                    <InfoRow label="Middle Name" value={patient.middleName || "—"} />
                    <InfoRow
                      label="Date of Birth"
                      value={
                        age != null
                          ? `${formatDob(patient.dateOfBirth)} (${age} yrs)`
                          : formatDob(patient.dateOfBirth)
                      }
                    />
                    <InfoRow label="Mobile Number" value={patient.mobileNumber || "—"} />
                    <InfoRow label="Email Address" value={patient.email || "—"} />
                  </dl>
                </section>

                {/* Portal Account */}
                <section className="st-card flex h-full flex-col rounded-2xl p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--st-green-soft))]">
                        <Shield className="h-4 w-4 text-[hsl(var(--st-green))]" />
                      </span>
                      <h2 className="text-base font-bold text-[hsl(var(--st-text))]">Portal Account</h2>
                    </div>
                    {portalActive ? (
                      <span className="rounded-full bg-[hsl(var(--st-green-soft))] px-2 py-0.5 text-[11px] font-bold text-[hsl(var(--st-green))]">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-[hsl(var(--st-cream))] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--st-muted))]">
                        Not linked
                      </span>
                    )}
                  </div>
                  <dl className="flex-1">
                    <InfoRow
                      label="Document codes"
                      value={
                        <span className="text-xs font-medium text-[hsl(var(--st-muted))]">
                          Issued per result on upload or regenerate
                        </span>
                      }
                    />
                    <InfoRow label="Created" value={formatDateTime(patient.createdAt)} />
                    <InfoRow label="Last Updated" value={formatDateTime(patient.updatedAt)} />
                  </dl>
                </section>

                {/* Assigned Physician — derived from result file assignments */}
                <section className="st-card flex h-full min-h-0 flex-col rounded-2xl p-4 sm:p-5">
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D6EAF8]">
                      <Stethoscope className="h-4 w-4 text-[#1A5276]" />
                    </span>
                    <div>
                      <h2 className="text-base font-bold text-[hsl(var(--st-text))]">Assigned Physician</h2>
                      <p className="text-[11px] st-muted">From uploaded result assignments</p>
                    </div>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col">
                    {!results ? (
                      <div className="h-24 animate-pulse rounded-xl bg-[hsl(var(--st-cream))]" />
                    ) : resultPhysicians.length > 0 ? (
                      <div className="space-y-2 overflow-y-auto">
                        {resultPhysicians.map((p) => (
                          <div
                            key={p.id}
                            className="rounded-xl border border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))]/50 px-3 py-3"
                          >
                            <p className="text-sm font-semibold text-[hsl(var(--st-text))]">{p.name}</p>
                            <p className="mt-1 text-[11px] st-muted">
                              Assigned to {p.resultCount} result{p.resultCount === 1 ? "" : "s"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))]/40 px-4 py-8 text-center">
                        <Stethoscope className="mb-2 h-8 w-8 text-[hsl(var(--st-muted))]" />
                        <p className="text-sm font-medium text-[hsl(var(--st-text))]">No physician assigned yet</p>
                        <p className="mt-1 text-xs st-muted">
                          Assign physicians when uploading a result. Each assignment links only to that file.
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}

            {/* Diagnostic Results */}
            <section className="st-card flex min-h-0 flex-col overflow-hidden rounded-2xl">
              <div className="flex flex-col gap-3 border-b border-[hsl(var(--st-border))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[hsl(var(--st-muted))]" />
                    <h2 className="text-base font-bold text-[hsl(var(--st-text))]">Diagnostic Results</h2>
                  </div>
                  <p className="mt-0.5 text-xs st-muted">
                    Total {resultList.length} · Pending {pendingCount} · Reviewed {reviewedCount} · Released{" "}
                    {releasedCount} · Archived {archivedCount}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[12rem] flex-1 sm:flex-none">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--st-muted))]" />
                    <Input
                      value={resultSearch}
                      onChange={(e) => setResultSearch(e.target.value)}
                      placeholder="Search result..."
                      className="h-9 rounded-lg pl-8"
                      aria-label="Search results"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg border-[hsl(var(--st-border))] bg-white"
                      >
                        <Filter className="mr-1.5 h-3.5 w-3.5" />
                        Filter
                        {statusFilter !== "all" ? (
                          <span className="ml-1.5 rounded-full bg-[hsl(var(--st-green-soft))] px-1.5 text-[10px] font-bold text-[hsl(var(--st-green))]">
                            1
                          </span>
                        ) : null}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="staff-shell">
                      {(
                        [
                          ["all", "All statuses"],
                          ["pending", "Pending Review"],
                          ["reviewed", "Reviewed"],
                          ["released", "Released"],
                          ["archived", "Archived"],
                        ] as const
                      ).map(([value, label]) => (
                        <DropdownMenuItem key={value} onClick={() => setStatusFilter(value)}>
                          {label}
                          {statusFilter === value ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {pageRows.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
                  <p className="font-semibold text-[hsl(var(--st-text))]">No results found</p>
                  <p className="text-sm st-muted">
                    {debouncedResultSearch || statusFilter !== "all"
                      ? "Try a different search or clear filters."
                      : "Upload a diagnostic result for this patient."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="st-scroll overflow-x-auto">
                    <table className="w-full min-w-[64rem] text-sm">
                      <thead className="bg-[hsl(var(--st-cream))]">
                        <tr className="border-b border-[hsl(var(--st-border))]">
                          {[
                            "#",
                            "Date Uploaded",
                            "Study / Description",
                            "Accession No.",
                            "Status",
                            "Reviewed By",
                            "Doctor Comment",
                            "Actions",
                          ].map((h) => (
                            <th
                              key={h}
                              className={`px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--st-muted))] ${
                                h === "Actions" ? "text-right" : ""
                              }`}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[hsl(var(--st-border))]">
                        {pageRows.map((r, idx) => {
                          const review = primaryReview(r);
                          const label = statusLabel(r);
                          const rowNumber = (safePage - 1) * pageSize + idx + 1;
                          return (
                            <tr key={r.id} className="hover:bg-[hsl(var(--st-cream))]/60">
                              <td className="px-3 py-3 text-[hsl(var(--st-muted))]">{rowNumber}</td>
                              <td className="px-3 py-3 whitespace-nowrap text-[hsl(var(--st-text))]">
                                {formatShortDate(r.uploadedAt)}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex min-w-0 items-start gap-2">
                                  <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--st-maroon))]" />
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-[hsl(var(--st-text))]">
                                      {CATEGORY_LABELS[r.category] ?? r.category}
                                    </p>
                                    <p className="truncate text-xs st-muted">{r.originalFileName}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-[hsl(var(--st-muted))]">—</td>
                              <td className="px-3 py-3">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${statusBadgeClass(label)}`}
                                >
                                  {label}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                {review ? (
                                  <div>
                                    <p className="text-sm font-medium text-[hsl(var(--st-text))]">
                                      {review.physicianName}
                                    </p>
                                    <p className="text-[11px] st-muted">
                                      {review.reviewedAt ? formatDateTime(review.reviewedAt) : "—"}
                                    </p>
                                  </div>
                                ) : (
                                  <span className="st-muted">—</span>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {review?.comment ? (
                                  <p className="flex max-w-[14rem] items-start gap-1.5 truncate text-xs text-[hsl(var(--st-text))]">
                                    <MessageSquare className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[hsl(var(--st-muted))]" />
                                    <span className="truncate">{review.comment}</span>
                                  </p>
                                ) : (
                                  <span className="st-muted">—</span>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 rounded-lg border-[hsl(var(--st-border))] bg-white"
                                    onClick={() => openPreview(r)}
                                  >
                                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                                    View
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 rounded-lg"
                                        aria-label={`More actions for ${r.originalFileName}`}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="staff-shell">
                                      <DropdownMenuItem onClick={() => openPreview(r)}>Open preview</DropdownMenuItem>
                                      <DownloadMenuItem resultId={r.id} />
                                      {canRegen ? (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setDocRegen({
                                              id: r.id,
                                              title: r.originalFileName,
                                              category: r.category,
                                            });
                                            setDocRegenEmail(patient.email?.trim() ?? "");
                                            setDocRegenError(null);
                                          }}
                                        >
                                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                          Regenerate Access Code
                                        </DropdownMenuItem>
                                      ) : null}
                                      {canMutateResults && r.status === "pending" ? (
                                        <DropdownMenuItem onClick={() => handleRelease(r.id)}>
                                          Release
                                        </DropdownMenuItem>
                                      ) : null}
                                      {canMutateResults && r.status !== "archived" ? (
                                        <DropdownMenuItem onClick={() => handleArchive(r.id)}>
                                          <Archive className="mr-2 h-3.5 w-3.5" />
                                          Archive
                                        </DropdownMenuItem>
                                      ) : null}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-col gap-2 border-t border-[hsl(var(--st-border))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm st-muted">
                      Showing {rangeStart} – {rangeEnd} of {filteredResults.length} results
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-[hsl(var(--st-green))] px-2 text-sm font-semibold text-white">
                        {safePage}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        aria-label="Next page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>

      {canUpload ? (
        <UploadResultDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          patient={{
            id: patientId,
            patientHisId: patient.patientHisId,
            name: fullName,
            email: patient.email,
          }}
          onUploaded={() => void refetchResults()}
        />
      ) : null}

      <StaffResultPreviewDialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        result={preview}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="staff-shell sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Patient Information</DialogTitle>
            <DialogDescription>Update hospital patient contact and identity fields.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveInfo} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>HIS ID</Label>
                <Input value={patient.patientHisId} readOnly className="bg-[hsl(var(--st-cream))] font-mono" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-lastName">Last name</Label>
                <Input
                  id="edit-lastName"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-firstName">First name</Label>
                <Input
                  id="edit-firstName"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-middleName">Middle name</Label>
                <Input
                  id="edit-middleName"
                  value={form.middleName}
                  onChange={(e) => setForm((f) => ({ ...f, middleName: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-dob">Date of Birth</Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-mobile">Mobile</Label>
                <Input
                  id="edit-mobile"
                  value={form.mobileNumber}
                  onChange={(e) => setForm((f) => ({ ...f, mobileNumber: e.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updatePatient.isPending} className="bg-[hsl(var(--st-green))]">
                {updatePatient.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={docRegen != null}
        onOpenChange={(open) => {
          if (!open && !docRegenPending) {
            setDocRegen(null);
            setDocRegenError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Regenerate Document Access Code</DialogTitle>
            <DialogDescription>
              {docRegen
                ? `Document: ${docRegen.title}. The previous code for this document only will stop working.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="doc-regen-email">Recipient email</Label>
            {patient.email?.trim() ? (
              <p className="rounded-lg border border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))] px-3 py-2 text-sm">
                {patient.email.trim()}
              </p>
            ) : (
              <Input
                id="doc-regen-email"
                type="email"
                value={docRegenEmail}
                onChange={(e) => setDocRegenEmail(e.target.value)}
                placeholder="patient@example.com"
                required
              />
            )}
            {docRegenError ? <p className="text-sm text-red-700">{docRegenError}</p> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={docRegenPending}
              onClick={() => setDocRegen(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={docRegenPending}
              onClick={() => void handleDocumentRegen()}
            >
              {docRegenPending ? "Sending…" : "Regenerate & Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
