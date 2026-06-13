import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetPatient,
  getGetPatientQueryKey,
  useListPatientResultsStaff,
  getListPatientResultsStaffQueryKey,
  useRegenerateAccessCode,
  useReleaseResult,
  useGetResultDownloadUrl,
  getGetResultDownloadUrlQueryKey,
  useUpdateResult,
  customFetch,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ArrowLeft, Copy, Check, RefreshCw, Upload, Download, Archive, Stethoscope, Plus, X } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory", radiology: "Radiology", ultrasound: "Ultrasound",
  ct_scan: "CT Scan", mri: "MRI", ecg: "ECG", echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation", other: "Other Diagnostics",
};

const CATEGORY_COLORS: Record<string, string> = {
  laboratory: "bg-blue-100 text-blue-800", radiology: "bg-purple-100 text-purple-800",
  ultrasound: "bg-teal-100 text-teal-800", ct_scan: "bg-indigo-100 text-indigo-800",
  mri: "bg-violet-100 text-violet-800", ecg: "bg-orange-100 text-orange-800",
  echo_2d: "bg-pink-100 text-pink-800", rehabilitation: "bg-green-100 text-green-800",
  other: "bg-gray-100 text-gray-800",
};

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  released: "bg-green-100 text-green-800",
  archived: "bg-slate-100 text-slate-600",
};

interface AssignedPhysician { id: number; name: string; username: string; assignedAt: string }
interface PhysicianSearchResult { id: number; name: string; username: string }

function DownloadButton({ resultId }: { resultId: number }) {
  const [enabled, setEnabled] = useState(false);
  const { data } = useGetResultDownloadUrl(
    resultId,
    { query: { enabled, queryKey: getGetResultDownloadUrlQueryKey(resultId) } }
  );

  useEffect(() => {
    if (data?.url && enabled) {
      window.open(data.url, "_blank");
      setEnabled(false);
    }
  }, [data?.url, enabled]);

  return (
    <Button size="sm" variant="ghost" onClick={() => setEnabled(true)} title="Download">
      <Download className="w-4 h-4" />
    </Button>
  );
}

function PhysicianSection({
  patientId,
  canManage,
}: {
  patientId: number;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [physicians, setPhysicians] = useState<AssignedPhysician[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<PhysicianSearchResult[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const [adding, setAdding] = useState(false);

  const loadPhysicians = async () => {
    try {
      const data = await customFetch<AssignedPhysician[]>(`/api/patients/${patientId}/physicians`);
      setPhysicians(data);
    } catch {
      /* ignore — leave list as-is */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPhysicians(); }, [patientId]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const data = await customFetch<PhysicianSearchResult[]>(
          `/api/physicians?search=${encodeURIComponent(search)}`,
        );
        setSearchResults(data);
      } catch {
        /* ignore search errors */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const handleAssign = async (physician: PhysicianSearchResult) => {
    setAdding(true);
    setShowDrop(false);
    setSearch("");
    try {
      await customFetch(`/api/patients/${patientId}/physicians`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ physicianId: physician.id }),
      });
      toast({ title: `${physician.name} assigned to patient` });
      loadPhysicians();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to assign physician",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (physicianId: number, name: string) => {
    try {
      await customFetch(`/api/patients/${patientId}/physicians/${physicianId}`, {
        method: "DELETE",
      });
      toast({ title: `${name} removed from patient` });
      loadPhysicians();
    } catch {
      toast({ title: "Failed to remove physician", variant: "destructive" });
    }
  };

  if (loading) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold">Attending Physician(s)</h3>
        </div>
      </div>

      {physicians.length === 0 ? (
        <p className="text-sm text-muted-foreground">No physician assigned yet.</p>
      ) : (
        <div className="space-y-2">
          {physicians.map((p) => (
            <div key={p.id} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-primary/10 rounded-full flex items-center justify-center">
                  <Stethoscope className="w-3.5 h-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Assigned {new Date(p.assignedAt).toLocaleDateString("en-PH")}
                  </p>
                </div>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(p.id, p.name)}
                  title="Remove physician"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="relative">
          <div className="flex gap-2">
            <Input
              placeholder="Search and add physician..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowDrop(true); }}
              onFocus={() => setShowDrop(true)}
              onBlur={() => setTimeout(() => setShowDrop(false), 150)}
              className="text-sm"
            />
            <Button type="button" size="sm" variant="outline" disabled={adding} className="gap-1 flex-shrink-0">
              <Plus className="w-3.5 h-3.5" />Add
            </Button>
          </div>
          {showDrop && searchResults.length > 0 && (
            <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
              {searchResults
                .filter((r) => !physicians.some((p) => p.id === r.id))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-sm flex items-center gap-2"
                    onMouseDown={() => handleAssign(p)}
                  >
                    <Stethoscope className="w-3 h-3 text-muted-foreground" />
                    {p.name}
                    <span className="text-xs text-muted-foreground">@{p.username}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PatientDetailPage() {
  const [, params] = useRoute("/patients/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { auth } = useAuth();
  const [copied, setCopied] = useState(false);
  const patientId = parseInt(params?.id ?? "0", 10);

  const isAdmin = auth.user?.role === "super_admin";
  const isMedicalRecords = auth.user?.role === "medical_records";
  const canManagePhysicians = isAdmin || isMedicalRecords;
  const isPhysician = auth.user?.role === "physician";

  const { data: patient, isLoading, refetch: refetchPatient } = useGetPatient(
    patientId,
    { query: { queryKey: getGetPatientQueryKey(patientId), enabled: !!patientId } }
  );

  const { data: results, refetch: refetchResults } = useListPatientResultsStaff(
    patientId,
    { query: { queryKey: getListPatientResultsStaffQueryKey(patientId), enabled: !!patientId } }
  );

  const regenerate = useRegenerateAccessCode();
  const releaseResult = useReleaseResult();
  const archiveResult = useUpdateResult();

  const copyCode = () => {
    if (!patient) return;
    navigator.clipboard.writeText(patient.accessCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleRegenerate = () => {
    regenerate.mutate({ id: patientId }, {
      onSuccess: () => { toast({ title: "Access code regenerated" }); refetchPatient(); },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    });
  };

  const handleRelease = (resultId: number) => {
    releaseResult.mutate({ id: resultId, data: { releaseOption: "immediate" } }, {
      onSuccess: () => { toast({ title: "Result released" }); refetchResults(); },
      onError: () => toast({ title: "Failed to release", variant: "destructive" }),
    });
  };

  const handleArchive = (resultId: number) => {
    archiveResult.mutate({ id: resultId, data: { status: "archived" } }, {
      onSuccess: () => { toast({ title: "Result archived" }); refetchResults(); },
      onError: () => toast({ title: "Failed to archive", variant: "destructive" }),
    });
  };

  if (isLoading) return <StaffLayout><div className="text-center py-16 text-muted-foreground">Loading...</div></StaffLayout>;
  if (!patient) return <StaffLayout><div className="text-center py-16">Patient not found.</div></StaffLayout>;

  const resultList = Array.isArray(results) ? results : [];
  const assignedPhysicians: Array<{ id: number; name: string }> = (patient as any).assignedPhysicians ?? [];

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/patients")}>
            <ArrowLeft className="w-4 h-4 mr-1" />Back
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-primary">
              {patient.lastName}, {patient.firstName} {patient.middleName ?? ""}
            </h2>
            <p className="text-muted-foreground font-mono text-sm">{patient.patientHisId}</p>
          </div>
        </div>

        {/* Patient Info Card */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Date of Birth</p>
            <p className="font-medium">{new Date(patient.dateOfBirth).toLocaleDateString("en-PH")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Mobile</p>
            <p className="font-medium">{patient.mobileNumber ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="font-medium truncate">{patient.email ?? "—"}</p>
          </div>
          {!isPhysician && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Access Code</p>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm font-bold bg-muted px-2 py-1 rounded">{patient.accessCode}</span>
                <button onClick={copyCode} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {!isPhysician && (
                  <button onClick={handleRegenerate} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Regenerate">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Physician Section */}
        <PhysicianSection
          patientId={patientId}
          canManage={canManagePhysicians}
        />

        {/* Results */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Diagnostic Results</h3>
            {!isPhysician && (
              <Button onClick={() => setLocation(`/results/upload?patientId=${patientId}`)}>
                <Upload className="w-4 h-4 mr-2" />Upload Result
              </Button>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            {resultList.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <p>No results visible for your department yet.</p>
                {!isPhysician && (
                  <Button className="mt-4" variant="outline" onClick={() => setLocation(`/results/upload?patientId=${patientId}`)}>
                    <Upload className="w-4 h-4 mr-2" />Upload Result
                  </Button>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">File</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Uploaded</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {resultList.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${CATEGORY_COLORS[r.category] ?? "bg-gray-100 text-gray-700"}`}>
                          {CATEGORY_LABELS[r.category] ?? r.category}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-[180px]">{r.originalFileName}</p>
                        <p className="text-xs text-muted-foreground uppercase">{r.fileType}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full capitalize ${STATUS_CLASSES[r.status] ?? ""}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(r.uploadedAt).toLocaleDateString("en-PH")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <DownloadButton resultId={r.id} />
                          {!isPhysician && r.status === "pending" && (
                            <Button size="sm" variant="ghost" className="text-green-700" onClick={() => handleRelease(r.id)}>
                              Release
                            </Button>
                          )}
                          {!isPhysician && r.status !== "archived" && (
                            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => handleArchive(r.id)} title="Archive">
                              <Archive className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </StaffLayout>
  );
}
