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
import { Search, Download, Eye, User } from "lucide-react";

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

function ResultActionButtons({ resultId }: { resultId: number }) {
  const [action, setAction] = useState<"view" | "download" | null>(null);
  const { data, isFetching } = usePhysicianGetResultDownloadUrl(
    resultId,
    { query: { enabled: !!action, queryKey: getPhysicianGetResultDownloadUrlQueryKey(resultId) } }
  );

  if (data?.url && action) {
    const url = action === "view" ? `${data.url}?inline=1` : data.url;
    if (action === "view") {
      window.open(url, "_blank");
    } else {
      // Force download via anchor
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      a.click();
    }
    setAction(null);
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm" variant="ghost"
        onClick={() => setAction("view")}
        disabled={isFetching}
        title="View file"
        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
      >
        <Eye className="w-4 h-4" />
        <span className="ml-1 text-xs">View</span>
      </Button>
      <Button
        size="sm" variant="ghost"
        onClick={() => setAction("download")}
        disabled={isFetching}
        title="Download file"
        className="text-gray-600 hover:text-gray-700"
      >
        <Download className="w-4 h-4" />
        <span className="ml-1 text-xs">Download</span>
      </Button>
    </div>
  );
}

export default function PhysicianSearchPage() {
  const { auth } = useAuth();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);

  if (!auth.user || !["physician", "super_admin"].includes(auth.user.role)) {
    return <Redirect to="/login" />;
  }

  const searchParams = { q: submitted ?? "" };

  const { data: searchResult, isLoading: loadingPatient, isError } = usePhysicianSearchPatient(
    searchParams,
    { query: { queryKey: getPhysicianSearchPatientQueryKey(searchParams), enabled: !!submitted } }
  );

  // Handle both single patient (object) and multiple patients (array)
  const isMultiple = Array.isArray(searchResult);
  const singlePatient = !isMultiple ? searchResult : null;
  const patientList = isMultiple ? searchResult : (searchResult ? [searchResult] : []);

  const activePatientId = selectedPatientId ?? (singlePatient?.id ?? null);

  const { data: results, isLoading: loadingResults } = useListPatientResultsPhysician(
    activePatientId ?? 0,
    { query: { queryKey: getListPatientResultsPhysicianQueryKey(activePatientId ?? 0), enabled: !!activePatientId } }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setSelectedPatientId(null);
    setSubmitted(trimmed);
  };

  const resultList = Array.isArray(results) ? results : [];
  const activePatient = isMultiple
    ? patientList.find((p: any) => p.id === activePatientId)
    : singlePatient;

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-primary">Patient Search</h2>
          <p className="text-muted-foreground">Search for your assigned patients by HIS ID or last name</p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} className="flex gap-3 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by HIS ID or last name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!query.trim()}>Search</Button>
        </form>

        {submitted && (
          <>
            {loadingPatient && <div className="text-muted-foreground">Searching…</div>}

            {isError && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <p className="text-sm text-destructive">
                  No assigned patient found for "{submitted}". Only your assigned patients appear in search results.
                </p>
              </div>
            )}

            {/* Multiple results list */}
            {isMultiple && patientList.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{patientList.length} patient(s) found — select one to view results</p>
                {patientList.map((p: any) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPatientId(p.id)}
                    className={`w-full text-left bg-card border rounded-xl p-4 flex items-center gap-4 transition-colors hover:border-primary/50 ${activePatientId === p.id ? "border-primary ring-1 ring-primary/20" : "border-border"}`}
                  >
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{p.lastName}, {p.firstName} {p.middleName ?? ""}</p>
                      <p className="text-xs text-muted-foreground font-mono">{p.patientHisId}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Single patient card */}
            {activePatient && (
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-primary" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                    <div>
                      <p className="text-xs text-muted-foreground">Patient ID</p>
                      <p className="font-mono font-medium text-sm">{activePatient.patientHisId}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Name</p>
                      <p className="font-medium">{activePatient.lastName}, {activePatient.firstName} {activePatient.middleName ?? ""}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Date of Birth</p>
                      <p className="font-medium">{new Date(activePatient.dateOfBirth).toLocaleDateString("en-PH")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Released Results</p>
                      <p className="font-medium">{activePatient.resultCount}</p>
                    </div>
                  </div>
                </div>

                {/* Results list */}
                <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-muted/30">
                    <h3 className="font-semibold">Diagnostic Results</h3>
                  </div>
                  {loadingResults ? (
                    <div className="p-8 text-center text-muted-foreground">Loading results…</div>
                  ) : resultList.length === 0 ? (
                    <div className="p-10 text-center text-muted-foreground">No released results on file for this patient.</div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {resultList.map((r) => (
                        <li key={r.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                          {/* Top row: category badge + filename */}
                          <div className="flex items-start gap-2 mb-2">
                            <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${CATEGORY_COLORS[r.category] ?? "bg-gray-100 text-gray-700"}`}>
                              {CATEGORY_LABELS[r.category] ?? r.category}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{r.originalFileName}</p>
                              <p className="text-xs text-muted-foreground uppercase">{r.fileType}</p>
                            </div>
                          </div>
                          {/* Bottom row: status + date + actions */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_CLASSES[r.status] ?? ""}`}>
                                {r.status}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(r.uploadedAt).toLocaleDateString("en-PH")}
                              </span>
                            </div>
                            <ResultActionButtons resultId={r.id} />
                          </div>
                        </li>
                      ))}
                    </ul>
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
