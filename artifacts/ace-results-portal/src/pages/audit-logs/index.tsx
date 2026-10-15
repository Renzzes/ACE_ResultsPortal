import { useState } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { useAuthoritativeRole } from "@/lib/auth";
import { mayRequestAuditOrArchive } from "@/lib/workflow-stability";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ACTION_STYLES: Record<string, string> = {
  login: "bg-blue-100 text-blue-800",
  logout: "bg-slate-100 text-slate-700",
  upload: "bg-green-100 text-green-800",
  edit: "bg-yellow-100 text-yellow-800",
  delete: "bg-red-100 text-red-800",
  view: "bg-purple-100 text-purple-800",
  download: "bg-teal-100 text-teal-800",
  access_denied: "bg-red-100 text-red-900",
  access_code_regen: "bg-orange-100 text-orange-800",
};

const ACTION_LABELS: Record<string, string> = {
  login: "Login", logout: "Logout", upload: "Upload", edit: "Edit",
  delete: "Delete", view: "View", download: "Download",
  access_denied: "Access Denied", access_code_regen: "Code Regen",
};

const ACTIONS = ["login", "logout", "upload", "edit", "delete", "view", "download", "access_denied", "access_code_regen"];

export default function AuditLogsPage() {
  const role = useAuthoritativeRole();
  const [action, setAction] = useState("");
  const [patientId, setPatientId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const params: Record<string, unknown> = { page, limit: 50 };
  if (action) params.action = action;
  if (patientId) params.patientId = patientId;
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;

  const { data, isLoading } = useListAuditLogs(
    params as any,
    { query: { queryKey: getListAuditLogsQueryKey(params as any), enabled: mayRequestAuditOrArchive(role) } }
  );

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  return (
    <StaffLayout title="Audit Logs" fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <p className="st-muted text-sm">Track all system activity and access events</p>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            className="border border-border rounded-md px-3 py-2 text-sm bg-background"
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
          >
            <option value="">All Actions</option>
            {ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
          </select>
          <Input
            placeholder="Patient HIS ID..."
            value={patientId}
            className="w-40"
            onChange={(e) => { setPatientId(e.target.value); setPage(1); }}
          />
          <div className="flex items-center gap-2">
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-36 text-sm" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-36 text-sm" />
          </div>
          {(action || patientId || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setAction(""); setPatientId(""); setDateFrom(""); setDateTo(""); setPage(1); }}>
              Clear filters
            </Button>
          )}
        </div>

        <div className="st-card flex-1 min-h-0 overflow-auto rounded-2xl">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading audit logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No audit log entries found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[hsl(var(--st-cream))] border-b border-[hsl(var(--st-border))]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Patient</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Details</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString("en-PH")}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${ACTION_STYLES[l.action] ?? "bg-gray-100 text-gray-700"}`}>
                        {ACTION_LABELS[l.action] ?? l.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">{l.userName ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{l.patientHisId ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{l.details ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.ipAddress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{total} total entries</p>
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
