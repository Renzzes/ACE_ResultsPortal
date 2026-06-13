import { useState } from "react";
import {
  useListArchivedResults,
  getListArchivedResultsQueryKey,
  useRestoreArchivedResult,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw, Search } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory", radiology: "Radiology", ultrasound: "Ultrasound",
  ct_scan: "CT Scan", mri: "MRI", ecg: "ECG", echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation", other: "Other Diagnostics",
};

export default function ArchivePage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const params = { page, limit: 20, search: search || undefined };
  const { data, isLoading, refetch } = useListArchivedResults(
    params as any,
    { query: { queryKey: getListArchivedResultsQueryKey(params as any) } }
  );

  const restore = useRestoreArchivedResult();

  const handleRestore = (id: number, name: string) => {
    if (!confirm(`Restore "${name}" from archive? It will be set back to Pending status.`)) return;
    restore.mutate({ id }, {
      onSuccess: () => { toast({ title: "Result restored from archive" }); refetch(); },
      onError: () => toast({ title: "Failed to restore", variant: "destructive" }),
    });
  };

  const archived = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-primary">Archive</h2>
          <p className="text-muted-foreground">Archived diagnostic results — restore to make them active again</p>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by patient name or HIS ID..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading archived results...</div>
          ) : archived.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <p>No archived results found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Patient</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">File</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Uploaded</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Archived</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {archived.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.patientName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.patientHisId}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{CATEGORY_LABELS[r.category] ?? r.category}</td>
                    <td className="px-4 py-3">
                      <p className="truncate max-w-[180px]">{r.originalFileName}</p>
                      <p className="text-xs text-muted-foreground uppercase">{r.fileType}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(r.originalUploadedAt).toLocaleDateString("en-PH")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(r.archivedAt).toLocaleDateString("en-PH")}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRestore(r.id, r.originalFileName)}
                          disabled={restore.isPending}
                        >
                          <RotateCcw className="w-4 h-4 mr-1" />Restore
                        </Button>
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
            <p className="text-sm text-muted-foreground">{total} archived results</p>
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
