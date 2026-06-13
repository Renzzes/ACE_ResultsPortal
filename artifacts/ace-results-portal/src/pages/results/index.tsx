import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListResults,
  getListResultsQueryKey,
  useGetResultDownloadUrl,
  getGetResultDownloadUrlQueryKey,
  useReleaseResult,
  useUpdateResult,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, Archive } from "lucide-react";

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

const CATEGORIES = [
  "laboratory", "radiology", "ultrasound", "ct_scan", "mri", "ecg", "echo_2d", "rehabilitation", "other",
];

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

export default function ResultsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const params: Record<string, unknown> = { page, limit: 20 };
  if (category) params.category = category;
  if (status) params.status = status;
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;

  const { data, isLoading, refetch } = useListResults(
    params as any,
    { query: { queryKey: getListResultsQueryKey(params as any) } }
  );

  const releaseResult = useReleaseResult();
  const archiveResult = useUpdateResult();

  const results = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const handleRelease = (id: number) => {
    releaseResult.mutate({ id, data: { releaseOption: "immediate" } }, {
      onSuccess: () => { toast({ title: "Result released" }); refetch(); },
      onError: () => toast({ title: "Failed to release", variant: "destructive" }),
    });
  };

  const handleArchive = (id: number) => {
    archiveResult.mutate({ id, data: { status: "archived" } }, {
      onSuccess: () => { toast({ title: "Result archived" }); refetch(); },
      onError: () => toast({ title: "Failed to archive", variant: "destructive" }),
    });
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-primary">Results</h2>
            <p className="text-muted-foreground">All diagnostic results across patients</p>
          </div>
          <Button onClick={() => setLocation("/results/upload")}>
            <Upload className="w-4 h-4 mr-2" />Upload Result
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            className="border border-border rounded-md px-3 py-2 text-sm bg-background"
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <select
            className="border border-border rounded-md px-3 py-2 text-sm bg-background"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="released">Released</option>
            <option value="archived">Archived</option>
          </select>
          <div className="flex items-center gap-2">
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-36 text-sm" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-36 text-sm" />
          </div>
          {(category || status || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setCategory(""); setStatus(""); setDateFrom(""); setDateTo(""); setPage(1); }}>
              Clear filters
            </Button>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading results...</div>
          ) : results.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">No results found matching your filters.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Patient</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">File</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Uploaded By</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.patientName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.patientHisId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${CATEGORY_COLORS[r.category] ?? "bg-gray-100 text-gray-700"}`}>
                        {CATEGORY_LABELS[r.category] ?? r.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="truncate max-w-[160px]">{r.originalFileName}</p>
                      <p className="text-xs text-muted-foreground uppercase">{r.fileType}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full capitalize ${STATUS_CLASSES[r.status] ?? ""}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.uploadedByName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(r.uploadedAt).toLocaleDateString("en-PH")}</td>
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Showing {results.length} of {total} results</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <span className="flex items-center px-3 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </StaffLayout>
  );
}
