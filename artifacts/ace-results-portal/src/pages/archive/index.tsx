import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListArchivedResults,
  getListArchivedResultsQueryKey,
  useRestoreArchivedResult,
  getListResultsQueryKey,
  getGetDashboardStatsQueryKey,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuthoritativeRole } from "@/lib/auth";
import { mayRequestAuditOrArchive } from "@/lib/workflow-stability";
import { RotateCcw, Search } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory", radiology: "Radiology", ultrasound: "Ultrasound",
  ct_scan: "CT Scan", mri: "MRI", ecg: "ECG", echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation", other: "Other Diagnostics",
};

type RestoreTarget = { id: number; name: string };

export default function ArchivePage() {
  const role = useAuthoritativeRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const { toast } = useToast();

  const params = { page, limit: 20, search: search || undefined };
  const { data, isLoading, refetch } = useListArchivedResults(
    params as any,
    {
      query: {
        queryKey: getListArchivedResultsQueryKey(params as any),
        enabled: mayRequestAuditOrArchive(role),
        refetchOnMount: "always",
        staleTime: 0,
      },
    },
  );

  const restore = useRestoreArchivedResult();

  const confirmRestore = () => {
    if (!restoreTarget) return;
    const { id } = restoreTarget;
    restore.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Result restored from archive" });
          setRestoreTarget(null);
          void refetch();
          void queryClient.invalidateQueries({ queryKey: getListArchivedResultsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListResultsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
        },
        onError: () => toast({ title: "Failed to restore", variant: "destructive" }),
      },
    );
  };

  const archived = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <StaffLayout title="Archive" fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="st-muted text-sm">Archived diagnostic results — restore to make them active again</p>
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 st-muted" />
            <Input
              className="pl-9"
              placeholder="Search by patient name or HIS ID..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        <div className="st-card flex-1 min-h-0 overflow-auto rounded-2xl">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading archived results...</div>
          ) : archived.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <p>No archived results found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[hsl(var(--st-cream))] border-b border-[hsl(var(--st-border))]">
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
                          onClick={() => setRestoreTarget({ id: r.id, name: r.originalFileName })}
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

      <AlertDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => {
          if (!open && !restore.isPending) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent className="border-[hsl(var(--st-border))] sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore from archive?</AlertDialogTitle>
            <AlertDialogDescription>
              Restore{" "}
              <span className="font-semibold text-foreground">
                “{restoreTarget?.name ?? "this result"}”
              </span>{" "}
              from archive? It will be set back to Pending status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restore.isPending}>Cancel</AlertDialogCancel>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-md bg-[#2f5d38] px-4 text-sm font-semibold text-white hover:bg-[#254a2d] disabled:opacity-50"
              disabled={restore.isPending}
              onClick={confirmRestore}
            >
              {restore.isPending ? "Restoring…" : "Restore"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StaffLayout>
  );
}
