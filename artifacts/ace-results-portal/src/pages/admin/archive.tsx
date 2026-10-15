import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListArchivedResultsQueryKey,
  useListArchivedResults,
  useRestoreArchivedResult,
  getListResultsQueryKey,
  getGetDashboardStatsQueryKey,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function AdminArchivePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const params = { page: 1, limit: 30, search: search || undefined };
  const { data, isLoading, refetch } = useListArchivedResults(params as never, {
    query: {
      queryKey: getListArchivedResultsQueryKey(params as never),
      refetchOnMount: "always",
      staleTime: 0,
    },
  });
  const restore = useRestoreArchivedResult();
  const rows = data?.data ?? [];

  return (
    <AdminLayout title="Archive" subtitle="Archived results stay out of the patient portal until restored." fill>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient or HIS ID" className="max-w-sm border-[#E3E8E4]" />
        <section className="ad-card ace-scroll min-h-0 flex-1 overflow-auto rounded-xl">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-lg bg-[#EAF5EE]" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-[#66756C]">No archived results.</p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-[#EAF5EE]">
                <tr>
                  {["Patient", "File", "Department", "Archived", ""].map((header) => (
                    <th key={header} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#66756C]">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E8E4]">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium text-[#17251E]">{row.patientName || row.patientHisId}</td>
                    <td className="px-4 py-3 text-[#66756C]">{row.originalFileName}</td>
                    <td className="px-4 py-3 capitalize text-[#66756C]">{row.category.replaceAll("_", " ")}</td>
                    <td className="px-4 py-3 text-[#66756C]">{new Date(row.archivedAt).toLocaleString("en-PH")}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-[#1F6B45]"
                        onClick={() =>
                          restore.mutate(
                            { id: row.id },
                            {
                              onSuccess: () => {
                                toast({ title: "Result restored" });
                                void refetch();
                                void queryClient.invalidateQueries({
                                  queryKey: getListArchivedResultsQueryKey(),
                                });
                                void queryClient.invalidateQueries({ queryKey: getListResultsQueryKey() });
                                void queryClient.invalidateQueries({
                                  queryKey: getGetDashboardStatsQueryKey(),
                                });
                              },
                              onError: () => toast({ title: "Could not restore", variant: "destructive" }),
                            },
                          )
                        }
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
