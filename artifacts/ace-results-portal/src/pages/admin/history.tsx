import { useState } from "react";
import { getListAuditLogsQueryKey, useListAuditLogs } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { AdminCard, AdminTable } from "@/components/admin/shared";
import { Input } from "@/components/ui/input";

const ACTIONS = [
  { value: "", label: "All actions" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "upload", label: "Upload" },
  { value: "edit", label: "Edit" },
  { value: "delete", label: "Delete" },
  { value: "view", label: "View" },
  { value: "download", label: "Download" },
  { value: "access_denied", label: "Access denied" },
  { value: "access_code_regen", label: "Code regen" },
];

export default function AdminHistoryPage() {
  const [action, setAction] = useState("");
  const [patientId, setPatientId] = useState("");
  const [page, setPage] = useState(1);
  const params = {
    page,
    limit: 40,
    ...(action ? { action } : {}),
    ...(patientId ? { patientId } : {}),
  };
  const { data, isLoading } = useListAuditLogs(params as never, {
    query: { queryKey: getListAuditLogsQueryKey(params as never) },
  });
  const logs = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <AdminLayout title="Audit Logs / History" subtitle="Live audit trail from ACE_ResultsPortal.dbo.audit_logs." fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-[#DDE5E0] bg-white px-3 text-sm"
          >
            {ACTIONS.map((item) => (
              <option key={item.value || "all"} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <Input
            value={patientId}
            onChange={(event) => {
              setPatientId(event.target.value);
              setPage(1);
            }}
            placeholder="Patient HIS ID"
            className="w-44 border-[#DDE5E0] bg-white"
          />
        </div>
        <AdminCard className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AdminTable
            headers={["When", "Action", "Who", "Patient", "Details"]}
            loading={isLoading}
            empty={!isLoading && logs.length === 0 ? "No audit history for this filter." : undefined}
          >
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-3 text-[#64706A]">{new Date(log.createdAt).toLocaleString("en-PH")}</td>
                <td className="px-4 py-3 font-semibold capitalize text-[#153D2B]">{String(log.action).replaceAll("_", " ")}</td>
                <td className="px-4 py-3 text-[#17221D]">{log.userName || "System"}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#64706A]">{log.patientHisId || "—"}</td>
                <td className="px-4 py-3 text-[#64706A]">{log.details || "—"}</td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
        {total > 40 ? (
          <div className="flex justify-end gap-2 text-sm">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[#DDE5E0] bg-white px-3 py-1.5 disabled:opacity-40">
              Previous
            </button>
            <button type="button" disabled={page * 40 >= total} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[#DDE5E0] bg-white px-3 py-1.5 disabled:opacity-40">
              Next
            </button>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
