import { useState } from "react";
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
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Copy, Check, RefreshCw, Upload, Download, Archive } from "lucide-react";

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

function DownloadButton({ resultId }: { resultId: number }) {
  const [enabled, setEnabled] = useState(false);
  const { data } = useGetResultDownloadUrl(
    resultId,
    { query: { enabled, queryKey: getGetResultDownloadUrlQueryKey(resultId) } }
  );

  if (data?.url && enabled) {
    window.open(data.url, "_blank");
    setEnabled(false);
  }

  return (
    <Button size="sm" variant="ghost" onClick={() => setEnabled(true)} title="Download">
      <Download className="w-4 h-4" />
    </Button>
  );
}

export default function PatientDetailPage() {
  const [, params] = useRoute("/patients/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const patientId = parseInt(params?.id ?? "0", 10);

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
          <div>
            <p className="text-xs text-muted-foreground mb-1">Access Code</p>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-bold bg-muted px-2 py-1 rounded">{patient.accessCode}</span>
              <button onClick={copyCode} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button onClick={handleRegenerate} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Regenerate">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Diagnostic Results</h3>
            <Button onClick={() => setLocation(`/results/upload?patientId=${patientId}`)}>
              <Upload className="w-4 h-4 mr-2" />Upload Result
            </Button>
          </div>

          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            {resultList.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <p>No results yet. Upload the first diagnostic result for this patient.</p>
                <Button className="mt-4" variant="outline" onClick={() => setLocation(`/results/upload?patientId=${patientId}`)}>
                  <Upload className="w-4 h-4 mr-2" />Upload Result
                </Button>
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
                          {r.status === "pending" && (
                            <Button size="sm" variant="ghost" className="text-green-700" onClick={() => handleRelease(r.id)}>
                              Release
                            </Button>
                          )}
                          {r.status !== "archived" && (
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
