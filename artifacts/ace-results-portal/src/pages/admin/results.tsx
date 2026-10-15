import { useState } from "react";
import { getListResultsQueryKey, getResultDownloadUrl, useListResults } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ADMIN_PENDING_RESULTS } from "@/lib/admin-mock-data";

const STATUS = ["", "pending", "released", "archived"] as const;

export default function AdminResultsPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<number | null>(null);
  const params = { page: 1, limit: 30, status: status || undefined };
  const { data, isLoading } = useListResults(params as never, {
    query: { queryKey: getListResultsQueryKey(params as never) },
  });
  const live = data?.data ?? [];
  const rows =
    live.length > 0
      ? live.filter((row) => {
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return `${row.originalFileName} ${row.patientName ?? ""} ${row.patientHisId ?? ""}`.toLowerCase().includes(q);
        })
      : ADMIN_PENDING_RESULTS.map((row, index) => ({
          id: index + 1,
          originalFileName: row.name,
          patientName: row.patient,
          patientHisId: "—",
          category: row.department.toLowerCase(),
          status: "pending",
          uploadedAt: new Date().toISOString(),
          uploadedByName: "lab.station2",
        }));

  async function openUploadedFile(id: number) {
    setOpeningId(id);
    try {
      const data = await getResultDownloadUrl(id);
      if (!data?.url) {
        toast({ title: "File unavailable", description: "This result does not have a file to open.", variant: "destructive" });
        return;
      }
      const separator = data.url.includes("?") ? "&" : "?";
      const opened = window.open(`${data.url}${separator}inline=1`, "_blank", "noopener,noreferrer");
      if (!opened) {
        toast({ title: "Pop-up blocked", description: "Allow pop-ups to open the diagnostic file.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not open file", description: "You don't have permission to view this file.", variant: "destructive" });
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <AdminLayout title="Results Management" subtitle="Pending, released, and archived diagnostic files." fill>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-md border border-[#E3E8E4] bg-white px-3 text-sm"
          >
            {STATUS.map((item) => (
              <option key={item || "all"} value={item}>
                {item ? item[0].toUpperCase() + item.slice(1) : "All statuses"}
              </option>
            ))}
          </select>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by patient or file" className="w-full max-w-xs border-[#E3E8E4]" />
        </div>
        <section className="ad-card ace-scroll min-h-0 flex-1 overflow-auto rounded-xl">
          {isLoading && live.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-lg bg-[#EAF5EE]" />
              ))}
            </div>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-[#EAF5EE]">
                <tr>
                  {["Result", "Patient", "Department", "Status", "Uploaded by", ""].map((header) => (
                    <th key={header} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#66756C]">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E8E4]">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium text-[#17251E]">{row.originalFileName}</td>
                    <td className="px-4 py-3 text-[#66756C]">{row.patientName || "—"}</td>
                    <td className="px-4 py-3 capitalize text-[#66756C]">{String(row.category).replaceAll("_", " ")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.status === "pending" ? "bg-[#F8ECEF] text-[#8B3A46]" : row.status === "released" ? "bg-[#EAF5EE] text-[#1F6B45]" : "bg-[#F7F8F5] text-[#66756C]"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#66756C]">{row.uploadedByName || "Staff"}</td>
                    <td className="px-4 py-3 text-right">
                      {live.length > 0 ? (
                        <button
                          type="button"
                          className="text-[12px] font-semibold text-[#1F6B45] disabled:opacity-60"
                          disabled={openingId === row.id}
                          onClick={() => void openUploadedFile(row.id)}
                        >
                          {openingId === row.id ? "Opening…" : "Open"}
                        </button>
                      ) : null}
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
