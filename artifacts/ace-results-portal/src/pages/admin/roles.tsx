import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useToast } from "@/hooks/use-toast";
import {
  fetchRolePermissions,
  saveRolePermissions,
  type RolePermissionRow,
} from "@/lib/admin-api";
import { Check } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Administrator",
  physician: "Physician",
};

const COLS = [
  { key: "users", label: "Manage users" },
  { key: "patients", label: "Patients" },
  { key: "results", label: "Results" },
  { key: "upload_results", label: "Upload results" },
  { key: "audit", label: "Audit logs" },
  { key: "archive", label: "Archive" },
  { key: "settings", label: "System settings" },
] as const;

export default function AdminRolesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-role-permissions"],
    queryFn: fetchRolePermissions,
  });
  const [rows, setRows] = useState<RolePermissionRow[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.rows) {
      setRows(data.rows.map((row) => ({ ...row })));
      setDirty(false);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => saveRolePermissions(rows),
    onSuccess: async (matrix) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-role-permissions"] });
      setRows(matrix.rows.map((row) => ({ ...row })));
      setDirty(false);
      toast({ title: "Permissions saved", description: matrix.message ?? `Stored in ${matrix.source}.` });
    },
    onError: () => toast({ title: "Could not save permissions", variant: "destructive" }),
  });

  function toggle(role: RolePermissionRow["role"], key: (typeof COLS)[number]["key"]) {
    if (role === "super_admin") return;
    setRows((current) =>
      current.map((row) => (row.role === role ? { ...row, [key]: !row[key] } : row)),
    );
    setDirty(true);
  }

  return (
    <AdminLayout
      title="Roles & Permissions"
      subtitle="Toggle access for each role. Changes apply to API authorization after save."
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#66756C]">
          {data?.message ?? (data ? `Source: ${data.source}` : "Loading permission matrix…")}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => {
              if (data?.rows) {
                setRows(data.rows.map((row) => ({ ...row })));
                setDirty(false);
              } else {
                void refetch();
              }
            }}
            className="rounded-lg border border-[#E3E8E4] bg-white px-3 py-2 text-sm font-semibold text-[#0F3D2E] disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-lg bg-[#0F3D2E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {isError ? (
        <div className="ad-card rounded-xl p-4 text-sm text-[#8B3A46]">
          Unable to load role permissions.{" "}
          <button type="button" className="font-semibold underline" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="ad-card overflow-x-auto rounded-xl">
        <table className="w-full min-w-[840px] text-sm">
          <thead className="bg-[#EAF5EE]">
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#66756C]">
                Role
              </th>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#66756C]"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E8E4]">
            {(isLoading ? [] : rows).map((row) => (
              <tr key={row.role}>
                <td className="px-4 py-3 font-semibold capitalize text-[#17251E]">
                  {ROLE_LABELS[row.role] ?? row.role.replace(/_/g, " ")}
                </td>
                {COLS.map((col) => {
                  const allowed = row[col.key];
                  const locked = row.role === "super_admin";
                  return (
                    <td key={col.key} className="px-4 py-3">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => toggle(row.role, col.key)}
                        title={locked ? "Administrator permissions are always allowed" : "Click to toggle"}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                          allowed
                            ? "bg-[#EAF5EE] text-[#1F6B45] hover:bg-[#d7ebdd]"
                            : "bg-[#F3F4F3] text-[#66756C] hover:bg-[#E8EBE9]"
                        } ${locked ? "cursor-default opacity-90" : "cursor-pointer"}`}
                      >
                        {allowed ? <Check className="h-3 w-3" /> : null}
                        {allowed ? "Allowed" : "Denied"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {isLoading ? (
              <tr>
                <td colSpan={COLS.length + 1} className="px-4 py-6 text-[#66756C]">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      <p className="mt-3 text-[12px] text-[#66756C]">
        Optional SQL persistence: run <code>docs/migration/sql/003_create_role_permissions.sql</code> in SSMS. For the
        Upload Results column on an existing database, also run{" "}
        <code>docs/migration/sql/017_role_permission_upload_results.sql</code>. Until then, saves use a local config
        file under the API server data directory.
      </p>
    </AdminLayout>
  );
}
