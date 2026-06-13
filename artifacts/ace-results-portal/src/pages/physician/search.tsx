import { useState } from "react";
import {
  usePhysicianSearchPatient,
  getPhysicianSearchPatientQueryKey,
  useListPatientResultsPhysician,
  getListPatientResultsPhysicianQueryKey,
  usePhysicianGetResultDownloadUrl,
  getPhysicianGetResultDownloadUrlQueryKey,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { Search, Download, User } from "lucide-react";

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

function ResultDownloadButton({ resultId }: { resultId: number }) {
  const [enabled, setEnabled] = useState(false);
  const { data } = usePhysicianGetResultDownloadUrl(
    resultId,
    { query: { enabled, queryKey: getPhysicianGetResultDownloadUrlQueryKey(resultId) } }
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

export default function PhysicianSearchPage() {
  const { auth } = useAuth();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  if (!auth.user || !["physician", "super_admin"].includes(auth.user.role)) {
    return <Redirect to="/login" />;
  }

  const { data: patient, isLoading: loadingPatient, isError } = usePhysicianSearchPatient(
    { patientId: submitted },
    { query: { queryKey: getPhysicianSearchPatientQueryKey({ patientId: submitted }), enabled: !!submitted } }
  );

  const { data: results, isLoading: loadingResults } = useListPatientResultsPhysician(
    patient?.id ?? 0,
    { query: { queryKey: getListPatientResultsPhysicianQueryKey(patient?.id ?? 0), enabled: !!patient?.id } }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
  };

  const resultList = Array.isArray(results) ? results : [];

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-primary">Patient Search</h2>
          <p className="text-muted-foreground">Search for a patient by their Hospital Information System ID</p>
        </div>

        <form onSubmit={handleSearch} className="flex gap-3 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Enter Patient HIS ID..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!query.trim()}>Search</Button>
        </form>

        {submitted && (
          <>
            {loadingPatient && <div className="text-muted-foreground">Searching...</div>}

            {isError && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm text-destructive">No patient found with ID "{submitted}". Please verify the Patient HIS ID.</p>
              </div>
            )}

            {patient && (
              <div className="space-y-4">
                {/* Patient Card */}
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-primary" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                    <div>
                      <p className="text-xs text-muted-foreground">Patient ID</p>
                      <p className="font-mono font-medium text-sm">{patient.patientHisId}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Name</p>
                      <p className="font-medium">{patient.lastName}, {patient.firstName} {patient.middleName ?? ""}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Date of Birth</p>
                      <p className="font-medium">{new Date(patient.dateOfBirth).toLocaleDateString("en-PH")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Results</p>
                      <p className="font-medium">{patient.resultCount}</p>
                    </div>
                  </div>
                </div>

                {/* Results */}
                <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-muted/30">
                    <h3 className="font-semibold">Diagnostic Results</h3>
                  </div>
                  {loadingResults ? (
                    <div className="p-8 text-center text-muted-foreground">Loading results...</div>
                  ) : resultList.length === 0 ? (
                    <div className="p-10 text-center text-muted-foreground">No results on file for this patient.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b border-border">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">File</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                          <th className="text-right px-4 py-3 font-medium text-muted-foreground">Download</th>
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
                              <p className="truncate max-w-[200px]">{r.originalFileName}</p>
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
                            <td className="px-4 py-3 flex justify-end">
                              <ResultDownloadButton resultId={r.id} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </StaffLayout>
  );
}
