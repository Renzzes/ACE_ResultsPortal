import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListPatients,
  getListPatientsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, FileText, X } from "lucide-react";

const CATEGORIES = [
  { value: "laboratory", label: "Laboratory" },
  { value: "radiology", label: "Radiology" },
  { value: "ultrasound", label: "Ultrasound" },
  { value: "ct_scan", label: "CT Scan" },
  { value: "mri", label: "MRI" },
  { value: "ecg", label: "ECG" },
  { value: "echo_2d", label: "2D Echo" },
  { value: "rehabilitation", label: "Rehabilitation" },
  { value: "other", label: "Other Diagnostics" },
];

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

export default function UploadResultPage() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const prefilledPatientId = new URLSearchParams(searchStr).get("patientId");
  const { toast } = useToast();

  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<{ id: number; patientHisId: string; name: string } | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [category, setCategory] = useState("");
  const [releaseOption, setReleaseOption] = useState("immediate");
  const [scheduledDate, setScheduledDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: patientsData } = useListPatients(
    { search: patientSearch || undefined, limit: 10 },
    { query: { queryKey: getListPatientsQueryKey({ search: patientSearch || undefined, limit: 10 }), enabled: !!patientSearch } }
  );

  // Prefill patient if patientId provided in URL
  const { data: prefillData } = useListPatients(
    { search: prefilledPatientId || undefined, limit: 1 },
    {
      query: {
        queryKey: getListPatientsQueryKey({ search: prefilledPatientId || undefined, limit: 1 }),
        enabled: !!prefilledPatientId && !selectedPatient,
      }
    }
  );

  useEffect(() => {
    if (prefillData?.data?.[0] && !selectedPatient) {
      const p = prefillData.data[0];
      setSelectedPatient({ id: p.id, patientHisId: p.patientHisId, name: `${p.lastName}, ${p.firstName}` });
    }
  }, [prefillData, selectedPatient]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) { toast({ title: "Please select a patient", variant: "destructive" }); return; }
    if (!category) { toast({ title: "Please select a category", variant: "destructive" }); return; }
    if (!file) { toast({ title: "Please select a file to upload", variant: "destructive" }); return; }

    setUploading(true);
    const formData = new FormData();
    formData.append("patientId", String(selectedPatient.id));
    formData.append("category", category);
    formData.append("releaseOption", releaseOption);
    if (releaseOption === "scheduled" && scheduledDate) formData.append("scheduledReleaseDate", scheduledDate);
    if (remarks) formData.append("remarks", remarks);
    formData.append("file", file);

    try {
      await customFetch("/api/results/upload", {
        method: "POST",
        body: formData,
      });
      toast({ title: "Result uploaded successfully" });
      setLocation(`/patients/${selectedPatient.id}`);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Upload failed",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <StaffLayout>
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/results")}>
            <ArrowLeft className="w-4 h-4 mr-1" />Back
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-primary">Upload Result</h2>
            <p className="text-muted-foreground">Upload a diagnostic result file for a patient</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm">
          {/* Patient Selector */}
          <div className="space-y-1.5 relative">
            <Label>Patient <span className="text-destructive">*</span></Label>
            {selectedPatient ? (
              <div className="flex items-center justify-between bg-muted/50 border border-border rounded-md px-3 py-2">
                <div>
                  <p className="font-medium text-sm">{selectedPatient.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{selectedPatient.patientHisId}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedPatient(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Search by name or HIS ID..."
                  value={patientSearch}
                  onChange={(e) => { setPatientSearch(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                />
                {showDropdown && patientsData?.data && patientsData.data.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {patientsData.data.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                        onMouseDown={() => {
                          setSelectedPatient({ id: p.id, patientHisId: p.patientHisId, name: `${p.lastName}, ${p.firstName}` });
                          setPatientSearch("");
                          setShowDropdown(false);
                        }}
                      >
                        <p className="text-sm font-medium">{p.lastName}, {p.firstName}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.patientHisId}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="category">Category <span className="text-destructive">*</span></Label>
            <select
              id="category"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Select category...</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* Release Option */}
          <div className="space-y-1.5">
            <Label htmlFor="release">Release Option <span className="text-destructive">*</span></Label>
            <select
              id="release"
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
              value={releaseOption}
              onChange={(e) => setReleaseOption(e.target.value)}
            >
              {RELEASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {releaseOption === "scheduled" && (
            <div className="space-y-1.5">
              <Label htmlFor="schedDate">Scheduled Release Date</Label>
              <Input id="schedDate" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
          )}

          {/* Remarks */}
          <div className="space-y-1.5">
            <Label htmlFor="remarks">Remarks</Label>
            <textarea
              id="remarks"
              rows={3}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Optional notes about this result..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          {/* File Upload */}
          <div className="space-y-1.5">
            <Label>File <span className="text-destructive">*</span></Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${dragOver ? "border-secondary bg-secondary/5" : "border-border hover:border-secondary/50"}`}
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
                  <FileText className="w-6 h-6 text-secondary" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Drop file here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, JPEG, PNG — max 50 MB</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={uploading} className="flex-1">
              {uploading ? "Uploading..." : "Upload Result"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setLocation("/results")}>Cancel</Button>
          </div>
        </form>
      </div>
    </StaffLayout>
  );
}
