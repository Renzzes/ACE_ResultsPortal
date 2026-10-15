import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { AdminCard, AdminTable } from "@/components/admin/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  fetchAdminSupportRequests,
  processAdminSupportRequest,
  type SupportRequestRow,
} from "@/lib/admin-api";

function categoryLabel(category: SupportRequestRow["category"]) {
  return category === "temporary_password"
    ? "Temporary password"
    : "Diagnostic access code";
}

function statusClass(status: SupportRequestRow["status"]) {
  if (status === "completed") return "bg-[#dceee3] text-[#2F7D4A]";
  if (status === "rejected") return "bg-[#F1EEE8] text-[#64706A]";
  return "bg-[#f4e9d8] text-[#8a5a2b]";
}

export default function AdminSupportRequestsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("pending");
  const [handoff, setHandoff] = useState<string | null>(null);

  const params = { status: status === "all" ? undefined : status, limit: 50 };
  const { data, isLoading } = useQuery({
    queryKey: ["admin-support-requests", params.status, params.limit],
    queryFn: () => fetchAdminSupportRequests(params),
  });

  const rows = useMemo(() => data?.data ?? [], [data]);

  const process = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "fulfill" | "reject" }) =>
      processAdminSupportRequest(id, { action }),
    onSuccess: async (result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-support-requests"] });
      const message =
        typeof result.message === "string"
          ? result.message
          : variables.action === "reject"
            ? "Request rejected."
            : "Request processed.";
      toast({
        title: variables.action === "reject" ? "Request rejected" : "Request processed",
        description: message,
        variant: result.emailAccepted === false ? "destructive" : "default",
      });
      if (typeof result.temporaryPassword === "string") {
        setHandoff(`Temporary password (authorized handoff only): ${result.temporaryPassword}`);
      } else if (typeof result.accessCode === "string") {
        setHandoff(`Access code (authorized handoff only): ${result.accessCode}`);
      } else {
        setHandoff(null);
      }
    },
    onError: (error) => {
      toast({
        title: "Could not process request",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <AdminLayout title="Patient support requests" fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#64706A]">
            Review Contact Support requests for temporary portal passwords and diagnostic access codes. Processing
            actions are audited without recording plaintext secrets.
          </p>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full border-[#DDE5E0] bg-white sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {handoff && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {handoff}
          </div>
        )}

        <AdminCard className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AdminTable
            headers={["Category", "Patient", "HIS ID", "Submitted", "Status", ""]}
            loading={isLoading && rows.length === 0}
            empty={!isLoading && rows.length === 0 ? "No support requests found." : undefined}
          >
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-[#F6F4EF]/80">
                <td className="px-4 py-3 text-[#17221D]">{categoryLabel(row.category)}</td>
                <td className="px-4 py-3 font-semibold text-[#17221D]">{row.lastName}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#64706A]">{row.patientHisId}</td>
                <td className="px-4 py-3 text-sm text-[#64706A]">
                  {new Date(row.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusClass(row.status)}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {(row.status === "pending" || row.status === "processing") && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-[#1F6B45] text-white hover:bg-[#185538]"
                        disabled={process.isPending}
                        onClick={() => process.mutate({ id: row.id, action: "fulfill" })}
                      >
                        Fulfill
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={process.isPending}
                        onClick={() => process.mutate({ id: row.id, action: "reject" })}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      </div>
    </AdminLayout>
  );
}
