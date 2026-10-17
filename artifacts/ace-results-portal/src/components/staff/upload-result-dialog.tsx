import { useCallback, useEffect, useRef, useState } from "react";
import {
  customFetch,
  useListPhysicians,
  getListPhysiciansQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  ALL_RESULT_CATEGORIES,
  staffNeedsUploadCategoryUi,
  useDebouncedValue,
} from "@/lib/staff-permissions";
import { preselectAttendingPhysicians, type UploadPhysician } from "@/lib/result-upload-physicians";
import { FileText, Upload, X } from "lucide-react";

const RELEASE_OPTIONS = [
  { value: "immediate", label: "Immediate — Release to patient now" },
  { value: "after_physician_review", label: "After Physician Review" },
  { value: "scheduled", label: "Scheduled — Set a release date" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadResultDialog({
  open,
  onOpenChange,
  patient,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: { id: number; patientHisId: string; name: string; email?: string | null };
  onUploaded?: () => void;
}) {
  const { toast } = useToast();
  const { auth } = useAuth();
  const needsCategory = staffNeedsUploadCategoryUi(auth.user?.role);
  const [category, setCategory] = useState<string>(ALL_RESULT_CATEGORIES[0]);
  const [releaseOption, setReleaseOption] = useState("immediate");
  const [scheduledDate, setScheduledDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(patient.email?.trim() ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [doctorSearch, setDoctorSearch] = useState("");
  const debouncedDoctorSearch = useDebouncedValue(doctorSearch, 350);
  const [attendingPhysicians, setAttendingPhysicians] = useState<UploadPhysician[]>([]);
  const [selectedDoctors, setSelectedDoctors] = useState<UploadPhysician[]>([]);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setRecipientEmail(patient.email?.trim() ?? "");
    let cancelled = false;
    void customFetch<UploadPhysician[]>(`/api/patients/${patient.id}/physicians`)
      .then((rows) => {
        if (cancelled) return;
        const attending = preselectAttendingPhysicians(rows ?? []);
        setAttendingPhysicians(attending);
        setSelectedDoctors(attending);
      })
      .catch(() => {
        if (!cancelled) {
          setAttendingPhysicians([]);
          setSelectedDoctors([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, patient.id, patient.email]);

  const {
    data: physiciansData,
    isLoading: doctorsLoading,
    isError: doctorsError,
  } = useListPhysicians(
    { search: debouncedDoctorSearch || undefined },
    {
      query: {
        queryKey: getListPhysiciansQueryKey({ search: debouncedDoctorSearch || undefined }),
        enabled: open && (showDoctorDropdown || !!debouncedDoctorSearch),
      },
    },
  );

  const reset = () => {
    setCategory(ALL_RESULT_CATEGORIES[0]);
    setReleaseOption("immediate");
    setScheduledDate("");
    setRemarks("");
    setRecipientEmail(patient.email?.trim() ?? "");
    setFile(null);
    setSelectedDoctors([]);
    setAttendingPhysicians([]);
    setDoctorSearch("");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { toast({ title: "Please select a file to upload", variant: "destructive" }); return; }
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
    formData.append("patientId", String(patient.id));
    formData.append("releaseOption", releaseOption);
    formData.append("recipientEmail", email);
    if (needsCategory) formData.append("category", category);
    if (releaseOption === "scheduled" && scheduledDate) formData.append("scheduledReleaseDate", scheduledDate);
    if (remarks) formData.append("remarks", remarks);
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
          description: uploaded.accessCodeEmail.error ?? "Resend from the result actions when ready.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Result uploaded and access code emailed" });
      }
      reset();
      onOpenChange(false);
      onUploaded?.();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "You don't have permission to perform this action.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="staff-shell max-w-xl max-h-[90vh] overflow-y-auto bg-[hsl(var(--st-card))] border-[hsl(var(--st-border))] sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle>Upload Result</DialogTitle>
          <DialogDescription>
            Attach a diagnostic file for {patient.name} ({patient.patientHisId}).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))] px-3 py-2">
            <p className="text-sm font-medium text-[hsl(var(--st-text))]">{patient.name}</p>
            <p className="text-xs font-mono st-muted">{patient.patientHisId}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="upload-recipient-email">
              Patient Email Address <span className="text-[hsl(var(--st-maroon))]">*</span>
            </Label>
            <Input
              id="upload-recipient-email"
              type="email"
              autoComplete="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="patient@example.com"
              required
            />
            <p className="text-xs st-muted">Used to email this document&apos;s access code.</p>
          </div>

          {needsCategory ? (
            <div className="space-y-1.5">
              <Label htmlFor="upload-category">
                Category <span className="text-[hsl(var(--st-maroon))]">*</span>
              </Label>
              <select
                id="upload-category"
                className="h-10 w-full rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 text-sm"
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
            </div>
          ) : null}

          <div className="space-y-1.5 relative">
            <Label>Attending physician</Label>
            <p className="text-sm">
              {attendingPhysicians.length
                ? attendingPhysicians.map((doctor) => doctor.name).join(", ")
                : "No attending physician"}
            </p>
            <Label>Assign physicians to this result file</Label>
            <p className="text-xs text-muted-foreground">
              Assignment applies only to this PDF/file. Other physicians will not see it unless also assigned here.
            </p>
            {selectedDoctors.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedDoctors.map((doctor) => (
                  <span key={doctor.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-sm">
                    {doctor.name}
                    <button type="button" aria-label={`Remove ${doctor.name}`} onClick={() => setSelectedDoctors((current) => current.filter((row) => row.id !== doctor.id))}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No result physician selected</p>
            )}
            <div className="relative">
              <Input
                placeholder="Search doctor..."
                value={doctorSearch}
                onChange={(e) => {
                  setDoctorSearch(e.target.value);
                  setShowDoctorDropdown(true);
                }}
                onFocus={() => setShowDoctorDropdown(true)}
                onBlur={() => setTimeout(() => setShowDoctorDropdown(false), 150)}
              />
              {showDoctorDropdown && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted text-sm text-muted-foreground"
                    onMouseDown={() => {
                      setSelectedDoctors([]);
                      setDoctorSearch("");
                      setShowDoctorDropdown(false);
                    }}
                  >
                    No doctor assigned
                  </button>
                  {doctorsLoading ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Loading doctors...</p>
                  ) : doctorsError ? (
                    <p className="px-3 py-2 text-sm text-destructive">Unable to load doctors.</p>
                  ) : !physiciansData?.length ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">No doctors available</p>
                  ) : (
                    physiciansData.map((doctor) => (
                      <button
                        key={doctor.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted"
                        onMouseDown={() => {
                          setSelectedDoctors((current) => preselectAttendingPhysicians([
                            ...current,
                            { id: doctor.id, name: doctor.name, username: doctor.username },
                          ]));
                          setDoctorSearch("");
                          setShowDoctorDropdown(false);
                        }}
                      >
                        <p className="text-sm font-medium">{doctor.name}</p>
                        {doctor.username ? <p className="text-xs text-muted-foreground font-mono">{doctor.username}</p> : null}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Optional read-only copy for the selected doctors. Does not control patient access or release.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="upload-release">Release Option <span className="text-destructive">*</span></Label>
            <select
              id="upload-release"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
              value={releaseOption}
              onChange={(e) => setReleaseOption(e.target.value)}
            >
              {RELEASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {releaseOption === "scheduled" && (
            <div className="space-y-1.5">
              <Label htmlFor="upload-sched">Scheduled Release Date</Label>
              <Input id="upload-sched" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="upload-remarks">Remarks</Label>
            <textarea
              id="upload-remarks"
              rows={3}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Optional notes about this result..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>File <span className="text-destructive">*</span></Label>
            <div
              className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer ${dragOver ? "border-[hsl(var(--st-green))] bg-[hsl(var(--st-green-soft))]" : "border-border hover:border-[hsl(var(--st-green))]/50"}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="w-6 h-6 text-[hsl(var(--st-green))]" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{file.name}</p>
                    <p className="text-xs st-muted">{formatBytes(file.size)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Drop file here or click to browse</p>
                  <p className="text-xs st-muted mt-1">PDF, JPEG, PNG — max 50 MB</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={uploading} className="flex-1 bg-[hsl(var(--st-green))] hover:bg-[hsl(var(--st-green))]/90 text-white">
              {uploading ? "Uploading..." : "Upload Result"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
