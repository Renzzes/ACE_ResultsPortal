import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useGetPatient,
  useListPatients,
  useListPhysicians,
  getGetPatientQueryKey,
  getListPatientsQueryKey,
  getListPhysiciansQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  ALL_RESULT_CATEGORIES,
  canUploadResultFileUi,
  staffNeedsUploadCategoryUi,
  useDebouncedValue,
} from "@/lib/staff-permissions";
import { preselectAttendingPhysicians, selectPreviewFile, type UploadPhysician } from "@/lib/result-upload-physicians";
import { patientPrefillId, uploadSelectionFromPatient } from "@/lib/workflow-stability";
import {
  ArrowLeft,
  Eye,
  FileSearch,
  FileText,
  Search,
  Upload,
  X,
} from "lucide-react";

const RELEASE_OPTIONS = [
  { value: "immediate", label: "Immediate — Release to patient now" },
  { value: "after_physician_review", label: "After Physician Review" },
  { value: "scheduled", label: "Scheduled — Set a release date" },
];

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function formatDob(dob?: string | null) {
  if (!dob) return "—";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fileLooksAllowed(file: File) {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
  const mimeOk =
    file.type === "application/pdf" ||
    file.type === "image/jpeg" ||
    file.type === "image/jpg" ||
    file.type === "image/png" ||
    file.type === "";
  return mimeOk && ACCEPTED_EXT.has(ext);
}

function SectionHeading({
  step,
  title,
  action,
}: {
  step: number;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[hsl(var(--st-green))] text-xs font-bold text-white">
          {step}
        </span>
        <h2 className="truncate text-sm font-bold text-[hsl(var(--st-text))]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export default function UploadResultPage() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const prefilledPatientId = patientPrefillId(new URLSearchParams(searchStr).get("patientId"));
  const { toast } = useToast();
  const { auth } = useAuth();
  const role = auth.user?.role;
  const canUpload = canUploadResultFileUi(role, auth.user?.permissions);
  const needsCategory = staffNeedsUploadCategoryUi(role);

  const [patientSearch, setPatientSearch] = useState("");
  const debouncedPatientSearch = useDebouncedValue(patientSearch, 350);
  const [selectedPatient, setSelectedPatient] = useState<{ id: number; patientHisId: string; name: string } | null>(null);
  const [showPatientPicker, setShowPatientPicker] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [doctorSearch, setDoctorSearch] = useState("");
  const debouncedDoctorSearch = useDebouncedValue(doctorSearch, 350);
  const [attendingPhysicians, setAttendingPhysicians] = useState<UploadPhysician[]>([]);
  const [primaryAttendingId, setPrimaryAttendingId] = useState<number | "">("");
  const [selectedDoctors, setSelectedDoctors] = useState<UploadPhysician[]>([]);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const [studyDescription, setStudyDescription] = useState("");
  const [category, setCategory] = useState<string>(ALL_RESULT_CATEGORIES[0]);
  const [releaseOption, setReleaseOption] = useState("immediate");
  const [scheduledDate, setScheduledDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patientSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = file ? URL.createObjectURL(file) : null;
    setPreviewUrl((current) => selectPreviewFile(current, next, URL.revokeObjectURL));
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  }, [file]);

  useEffect(() => {
    if (!selectedPatient) {
      setAttendingPhysicians([]);
      setSelectedDoctors([]);
      setPrimaryAttendingId("");
      return;
    }
    let cancelled = false;
    void customFetch<UploadPhysician[]>(`/api/patients/${selectedPatient.id}/physicians`)
      .then((rows) => {
        if (cancelled) return;
        const attending = preselectAttendingPhysicians(rows ?? []);
        setAttendingPhysicians(attending);
        setSelectedDoctors(attending);
        setPrimaryAttendingId(attending[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setAttendingPhysicians([]);
          setSelectedDoctors([]);
          setPrimaryAttendingId("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPatient]);

  const { data: patientsData } = useListPatients(
    { search: debouncedPatientSearch || undefined, limit: 10 },
    {
      query: {
        queryKey: getListPatientsQueryKey({ search: debouncedPatientSearch || undefined, limit: 10 }),
        enabled: !!debouncedPatientSearch,
      },
    },
  );

  const {
    data: physiciansData,
    isLoading: doctorsLoading,
    isError: doctorsError,
  } = useListPhysicians(
    { search: debouncedDoctorSearch || undefined },
    {
      query: {
        queryKey: getListPhysiciansQueryKey({ search: debouncedDoctorSearch || undefined }),
        enabled: showDoctorDropdown || !!debouncedDoctorSearch || primaryAttendingId !== "",
      },
    },
  );

  const { data: prefillPatient } = useGetPatient(prefilledPatientId ?? 0, {
    query: {
      queryKey: getGetPatientQueryKey(prefilledPatientId ?? 0),
      enabled: prefilledPatientId != null && !selectedPatient,
    },
  });

  const { data: selectedPatientDetails } = useGetPatient(selectedPatient?.id ?? 0, {
    query: {
      queryKey: getGetPatientQueryKey(selectedPatient?.id ?? 0),
      enabled: !!selectedPatient?.id,
    },
  });

  useEffect(() => {
    setRecipientEmail(selectedPatientDetails?.email?.trim() ?? "");
  }, [selectedPatientDetails?.id, selectedPatientDetails?.email]);

  useEffect(() => {
    if (prefillPatient && prefilledPatientId != null && prefillPatient.id === prefilledPatientId && !selectedPatient) {
      setSelectedPatient(uploadSelectionFromPatient(prefillPatient));
    }
  }, [prefillPatient, prefilledPatientId, selectedPatient]);

  const attendingOptions = useMemo(() => {
    const map = new Map<number, UploadPhysician>();
    for (const row of attendingPhysicians) map.set(row.id, row);
    for (const row of selectedDoctors) map.set(row.id, row);
    for (const row of physiciansData ?? []) {
      map.set(row.id, { id: row.id, name: row.name, username: row.username });
    }
    return [...map.values()];
  }, [attendingPhysicians, selectedDoctors, physiciansData]);

  const setSelectedFile = useCallback(
    (next: File | null) => {
      if (!next) {
        setFile(null);
        return;
      }
      if (!fileLooksAllowed(next)) {
        toast({
          title: "Unsupported file type",
          description: "Please upload a PDF, JPEG, or PNG file.",
          variant: "destructive",
        });
        return;
      }
      if (next.size > MAX_FILE_BYTES) {
        toast({
          title: "File too large",
          description: "Maximum file size is 50 MB.",
          variant: "destructive",
        });
        return;
      }
      setFile(next);
    },
    [toast],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) setSelectedFile(dropped);
    },
    [setSelectedFile],
  );

  const openFindPatient = () => {
    setShowPatientPicker(true);
    setShowDropdown(true);
    window.setTimeout(() => patientSearchRef.current?.focus(), 0);
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setPatientSearch("");
    setShowPatientPicker(true);
  };

  const addDoctor = (doctor: UploadPhysician) => {
    setSelectedDoctors((current) => preselectAttendingPhysicians([...current, doctor]));
    if (primaryAttendingId === "") setPrimaryAttendingId(doctor.id);
    setDoctorSearch("");
    setShowDoctorDropdown(false);
  };

  const removeDoctor = (id: number) => {
    setSelectedDoctors((current) => current.filter((row) => row.id !== id));
    if (primaryAttendingId === id) {
      setPrimaryAttendingId("");
    }
  };

  const onPrimaryAttendingChange = (raw: string) => {
    if (!raw) {
      setPrimaryAttendingId("");
      return;
    }
    const id = Number(raw);
    setPrimaryAttendingId(id);
    const picked = attendingOptions.find((row) => row.id === id);
    if (picked) {
      setSelectedDoctors((current) => preselectAttendingPhysicians([picked, ...current]));
    }
  };

  const composedRemarks = () => {
    const study = studyDescription.trim();
    const notes = remarks.trim();
    if (study && notes) return `${study}\n\n${notes}`;
    return study || notes || null;
  };

  const canSubmit = Boolean(selectedPatient && file && !uploading);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) {
      toast({ title: "Please select a patient", variant: "destructive" });
      return;
    }
    if (!file) {
      toast({ title: "Please select a file to upload", variant: "destructive" });
      return;
    }
    if (releaseOption === "scheduled" && !scheduledDate) {
      toast({ title: "Please choose a scheduled release date", variant: "destructive" });
      return;
    }
    if (needsCategory && !category) {
      toast({ title: "Please select a result category", variant: "destructive" });
      return;
    }
    const email = recipientEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: "Patient Email Address required",
        description: "Enter a valid email to send the document access code.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("patientId", String(selectedPatient.id));
    formData.append("releaseOption", releaseOption);
    formData.append("recipientEmail", email);
    if (needsCategory) formData.append("category", category);
    if (releaseOption === "scheduled" && scheduledDate) formData.append("scheduledReleaseDate", scheduledDate);
    const remarksPayload = composedRemarks();
    if (remarksPayload) formData.append("remarks", remarksPayload);
    for (const doctor of selectedDoctors) formData.append("physicianIds", String(doctor.id));
    formData.append("file", file);

    try {
      const uploaded = await customFetch<{
        accessCodeEmail?: { accepted?: boolean; error?: string | null };
      }>("/api/results/upload", {
        method: "POST",
        body: formData,
      });
      if (uploaded?.accessCodeEmail && uploaded.accessCodeEmail.accepted === false) {
        toast({
          title: "Document uploaded; access-code email failed",
          description: uploaded.accessCodeEmail.error ?? "You can resend the code from the patient record.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Result uploaded and access code emailed" });
      }
      setLocation(`/patients/${selectedPatient.id}`);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "You don't have permission to perform this action.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const isPdf = file?.type === "application/pdf" || !!file?.name.toLowerCase().endsWith(".pdf");
  const isImage =
    !!file &&
    (file.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(file.name));
  const patientAge = ageFromDob(selectedPatientDetails?.dateOfBirth);
  const previewStatus = !file
    ? "No file selected"
    : isPdf
      ? "PDF ready"
      : isImage
        ? "Image ready"
        : "Preview unavailable";

  if (!canUpload) {
    return (
      <StaffLayout showSearch fill>
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1 h-8 px-2"
              onClick={() => setLocation("/results")}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
            <h1 className="text-xl font-bold tracking-tight text-[hsl(var(--st-text))] sm:text-2xl">
              Upload Result
            </h1>
          </div>
          <div className="st-card rounded-2xl p-6">
            <p className="text-sm font-semibold text-[hsl(var(--st-text))]">
              Upload Results is not enabled for this account.
            </p>
            <p className="mt-2 text-sm st-muted">
              An administrator can grant the Upload Results permission under Admin → Roles &amp; Permissions.
            </p>
          </div>
        </div>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout showSearch fill>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 h-8 px-2"
            onClick={() => setLocation("/results")}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--st-green-soft))]">
              <FileText className="h-5 w-5 text-[hsl(var(--st-green))]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-[hsl(var(--st-text))] sm:text-2xl">
                Upload Result
              </h1>
              <p className="mt-0.5 max-w-3xl text-sm st-muted">
                Upload a diagnostic result file for a patient. The file will be visible to the patient portal based on
                the release option.
              </p>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] lg:overflow-hidden">
          <form
            onSubmit={handleSubmit}
            className="st-card flex min-h-0 flex-col overflow-visible rounded-2xl lg:h-full lg:overflow-hidden"
          >
            <div className="st-scroll min-h-0 flex-1 space-y-0 overflow-visible px-4 py-4 sm:px-5 lg:overflow-y-auto">
              {/* 1 — Patient Information */}
              <section>
                <SectionHeading
                  step={1}
                  title="Patient Information"
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg border-[hsl(var(--st-border))] bg-white"
                      onClick={openFindPatient}
                    >
                      <Search className="mr-1.5 h-3.5 w-3.5" />
                      Find Patient
                    </Button>
                  }
                />
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-[hsl(var(--st-muted))]">
                    Patient <span className="text-[hsl(var(--st-maroon))]">*</span>
                  </Label>
                  {selectedPatient && !showPatientPicker ? (
                    <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 py-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[hsl(var(--st-text))]">
                        {selectedPatient.name}
                      </p>
                      <button
                        type="button"
                        aria-label="Clear patient"
                        className="rounded-md p-1 text-[hsl(var(--st-muted))] hover:bg-[hsl(var(--st-cream))]"
                        onClick={clearPatient}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--st-muted))]" />
                      <Input
                        ref={patientSearchRef}
                        className="h-10 rounded-xl border-[hsl(var(--st-border))] pl-9"
                        placeholder="Search by name or HIS ID..."
                        value={patientSearch}
                        onChange={(e) => {
                          setPatientSearch(e.target.value);
                          setShowDropdown(true);
                        }}
                        onFocus={() => setShowDropdown(true)}
                        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                      />
                      {showDropdown && patientsData?.data && patientsData.data.length > 0 ? (
                        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-[hsl(var(--st-border))] bg-white shadow-lg">
                          {patientsData.data.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="w-full px-3 py-2 text-left hover:bg-[hsl(var(--st-cream))]"
                              onMouseDown={() => {
                                setSelectedPatient({
                                  id: p.id,
                                  patientHisId: p.patientHisId,
                                  name: `${p.lastName}, ${p.firstName}`,
                                });
                                setPatientSearch("");
                                setShowDropdown(false);
                                setShowPatientPicker(false);
                              }}
                            >
                              <p className="text-sm font-medium text-[hsl(var(--st-text))]">
                                {p.lastName}, {p.firstName}
                              </p>
                              <p className="font-mono text-xs st-muted">{p.patientHisId}</p>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {selectedPatient ? (
                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-[hsl(var(--st-cream))] px-3 py-2.5">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide st-muted">HIS ID</p>
                        <p className="mt-0.5 font-mono text-xs font-semibold text-[hsl(var(--st-text))]">
                          {selectedPatient.patientHisId}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide st-muted">Age</p>
                        <p className="mt-0.5 text-xs font-semibold text-[hsl(var(--st-text))]">
                          {patientAge != null ? `${patientAge} yrs` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide st-muted">Date of Birth</p>
                        <p className="mt-0.5 text-xs font-semibold text-[hsl(var(--st-text))]">
                          {formatDob(selectedPatientDetails?.dateOfBirth)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              <div className="my-4 border-t border-[hsl(var(--st-border))]" />

              {/* 2 — Attending Physician */}
              <section>
                <SectionHeading step={2} title="Attending Physician" />
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-[hsl(var(--st-muted))]">Attending Physician</Label>
                    <select
                      className="h-10 w-full rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 text-sm text-[hsl(var(--st-text))]"
                      value={primaryAttendingId === "" ? "" : String(primaryAttendingId)}
                      onChange={(e) => onPrimaryAttendingChange(e.target.value)}
                      disabled={!selectedPatient}
                    >
                      <option value="">Select attending physician…</option>
                      {attendingOptions.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctor.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5 relative">
                    <Label className="text-xs font-semibold text-[hsl(var(--st-muted))]">
                      Additional Physicians (optional)
                    </Label>
                    <Input
                      className="h-10 rounded-xl border-[hsl(var(--st-border))]"
                      placeholder="Search doctor to assign to this result…"
                      value={doctorSearch}
                      disabled={!selectedPatient}
                      onChange={(e) => {
                        setDoctorSearch(e.target.value);
                        setShowDoctorDropdown(true);
                      }}
                      onFocus={() => setShowDoctorDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDoctorDropdown(false), 150)}
                    />
                    {showDoctorDropdown && selectedPatient ? (
                      <div className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-xl border border-[hsl(var(--st-border))] bg-white shadow-lg">
                        {doctorsLoading ? (
                          <p className="px-3 py-2 text-sm st-muted">Loading doctors…</p>
                        ) : doctorsError ? (
                          <p className="px-3 py-2 text-sm text-red-700">Unable to load doctors.</p>
                        ) : !physiciansData?.length ? (
                          <p className="px-3 py-2 text-sm st-muted">No doctors available</p>
                        ) : (
                          physiciansData.map((doctor) => (
                            <button
                              key={doctor.id}
                              type="button"
                              className="w-full px-3 py-2 text-left hover:bg-[hsl(var(--st-cream))]"
                              onMouseDown={() =>
                                addDoctor({ id: doctor.id, name: doctor.name, username: doctor.username })
                              }
                            >
                              <p className="text-sm font-medium">{doctor.name}</p>
                              {doctor.username ? (
                                <p className="font-mono text-xs st-muted">@{doctor.username}</p>
                              ) : null}
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>

                  {selectedDoctors.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedDoctors.map((doctor) => (
                        <span
                          key={doctor.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--st-text))]"
                        >
                          {doctor.name}
                          <button
                            type="button"
                            aria-label={`Remove ${doctor.name}`}
                            className="rounded-full p-0.5 hover:bg-white"
                            onClick={() => removeDoctor(doctor.id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs st-muted">No result physicians selected yet.</p>
                  )}
                  <p className="text-[11px] st-muted">
                    Assignment applies only to this uploaded file. Other physicians will not see it unless also assigned
                    here.
                  </p>
                </div>
              </section>

              <div className="my-4 border-t border-[hsl(var(--st-border))]" />

              {/* 3 — Result Details */}
              <section>
                <SectionHeading step={3} title="Result Details" />
                <div className="space-y-3">
                  {needsCategory ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="category" className="text-xs font-semibold text-[hsl(var(--st-muted))]">
                        Category <span className="text-[hsl(var(--st-maroon))]">*</span>
                      </Label>
                      <select
                        id="category"
                        className="h-10 w-full rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 text-sm text-[hsl(var(--st-text))]"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        required
                      >
                        {ALL_RESULT_CATEGORIES.map((code) => (
                          <option key={code} value={code}>
                            {code.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] st-muted">
                        Required for Medical Records / Administrator uploads. Department staff categories are assigned
                        automatically.
                      </p>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="study" className="text-xs font-semibold text-[hsl(var(--st-muted))]">
                      Study / Description
                    </Label>
                    <Input
                      id="study"
                      className="h-10 rounded-xl border-[hsl(var(--st-border))]"
                      placeholder="e.g. CT SCAN - BRAIN"
                      value={studyDescription}
                      onChange={(e) => setStudyDescription(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="release" className="text-xs font-semibold text-[hsl(var(--st-muted))]">
                      Release Option <span className="text-[hsl(var(--st-maroon))]">*</span>
                    </Label>
                    <select
                      id="release"
                      className="h-10 w-full rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 text-sm text-[hsl(var(--st-text))]"
                      value={releaseOption}
                      onChange={(e) => setReleaseOption(e.target.value)}
                    >
                      {RELEASE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] st-muted">
                      Patient visibility follows this release option. Physician assignment does not approve or release
                      results.
                    </p>
                  </div>

                  {releaseOption === "scheduled" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="schedDate" className="text-xs font-semibold text-[hsl(var(--st-muted))]">
                        Scheduled Release Date
                      </Label>
                      <Input
                        id="schedDate"
                        type="date"
                        className="h-10 rounded-xl"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                      />
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-[hsl(var(--st-muted))]">Date Performed</Label>
                      <Input
                        type="date"
                        className="h-10 rounded-xl bg-[hsl(var(--st-cream))]"
                        disabled
                        value=""
                        title="Not stored by the current upload API"
                      />
                      <p className="text-[10px] st-muted">Not available</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-[hsl(var(--st-muted))]">Date Reported</Label>
                      <Input
                        type="date"
                        className="h-10 rounded-xl bg-[hsl(var(--st-cream))]"
                        disabled
                        value=""
                        title="Not stored by the current upload API"
                      />
                      <p className="text-[10px] st-muted">Not available</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="recipient-email" className="text-xs font-semibold text-[hsl(var(--st-muted))]">
                      Patient Email Address <span className="text-[hsl(var(--st-maroon))]">*</span>
                    </Label>
                    <Input
                      id="recipient-email"
                      type="email"
                      autoComplete="email"
                      className="h-10 rounded-xl"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="patient@example.com"
                      required
                    />
                    <p className="text-[10px] st-muted">Email for this document&apos;s access code.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="remarks" className="text-xs font-semibold text-[hsl(var(--st-muted))]">
                      Remarks
                    </Label>
                    <textarea
                      id="remarks"
                      rows={2}
                      className="w-full resize-none rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 py-2 text-sm text-[hsl(var(--st-text))] outline-none focus:ring-2 focus:ring-[hsl(var(--st-green))]/25"
                      placeholder="Optional notes about this result..."
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                    />
                  </div>
                </div>
              </section>

              <div className="my-4 border-t border-[hsl(var(--st-border))]" />

              {/* 4 — Upload File */}
              <section>
                <SectionHeading step={4} title="Upload File" />
                <div
                  className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                    dragOver
                      ? "border-[hsl(var(--st-green))] bg-[hsl(var(--st-green-soft))]/40"
                      : "border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))]/40 hover:border-[hsl(var(--st-green))]/50"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  />
                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileText className="h-6 w-6 text-[hsl(var(--st-maroon))]" />
                      <div className="min-w-0 text-left">
                        <p className="truncate text-sm font-semibold text-[hsl(var(--st-text))]">{file.name}</p>
                        <p className="text-xs st-muted">{formatBytes(file.size)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <Upload className="mx-auto mb-2 h-8 w-8 text-[hsl(var(--st-muted))]" />
                      <p className="text-sm font-semibold text-[hsl(var(--st-text))]">
                        Drag and drop file here, or click to browse
                      </p>
                      <p className="mt-1 text-xs st-muted">PDF, JPEG, PNG — max 50 MB</p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex shrink-0 gap-2 border-t border-[hsl(var(--st-border))] px-4 py-3 sm:px-5">
              <Button
                type="submit"
                disabled={!canSubmit}
                className="h-11 flex-[2] rounded-xl bg-[hsl(var(--st-maroon))] text-white hover:opacity-95 disabled:opacity-50"
              >
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? "Uploading…" : "Upload Result"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1 rounded-xl border-[hsl(var(--st-border))] bg-white"
                onClick={() => setLocation("/results")}
                disabled={uploading}
              >
                Cancel
              </Button>
            </div>
          </form>

          <aside className="st-card flex min-h-[22rem] flex-col overflow-hidden rounded-2xl lg:min-h-0 lg:h-full">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--st-border))] px-4 py-3">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-[hsl(var(--st-muted))]" />
                <h2 className="text-sm font-bold text-[hsl(var(--st-text))]">Document Preview</h2>
              </div>
              <span className="rounded-full bg-[hsl(var(--st-green-soft))] px-2.5 py-0.5 text-[11px] font-semibold text-[hsl(var(--st-green))]">
                {previewStatus}
              </span>
            </div>

            <div className="relative min-h-0 flex-1 bg-[hsl(var(--st-cream))]/30">
              {!file || !previewUrl ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm">
                    <FileSearch className="h-8 w-8 text-[hsl(var(--st-muted))]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[hsl(var(--st-text))]">Select a document to preview</p>
                    <p className="mt-1 max-w-sm text-xs st-muted">
                      The uploaded result file will appear here for verification before saving.
                    </p>
                  </div>
                </div>
              ) : isPdf ? (
                <iframe
                  title="Document preview"
                  src={previewUrl}
                  className="absolute inset-0 h-full w-full border-0 bg-white"
                />
              ) : isImage ? (
                <div className="absolute inset-0 flex items-center justify-center overflow-auto p-4">
                  <img
                    src={previewUrl}
                    alt="Document preview"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <p className="text-sm font-semibold text-[hsl(var(--st-text))]">{file.name}</p>
                  <p className="text-xs st-muted">Inline preview is not available for this file type.</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </StaffLayout>
  );
}
