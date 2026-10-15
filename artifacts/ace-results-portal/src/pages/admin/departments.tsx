import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { AdminCard, AdminTable, StatusPill } from "@/components/admin/shared";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  createDepartment,
  fetchAdminDepartments,
  updateDepartment,
  type Department,
} from "@/lib/admin-api";
import { Plus } from "lucide-react";

const SCOPE_OPTIONS: Array<{ value: Department["resultScope"]; label: string }> = [
  { value: "all", label: "All result categories" },
  { value: "laboratory", label: "Laboratory only" },
  { value: "radiology", label: "Radiology / imaging" },
  { value: "other", label: "Other / general" },
];

export default function AdminDepartmentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-departments"],
    queryFn: fetchAdminDepartments,
  });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [resultScope, setResultScope] = useState<Department["resultScope"]>("other");

  const rows = useMemo(() => data?.data ?? [], [data]);

  const create = useMutation({
    mutationFn: () =>
      createDepartment({
        name: name.trim(),
        code: code.trim() || undefined,
        resultScope,
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-departments"] });
      await queryClient.invalidateQueries({ queryKey: ["active-departments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-role-permissions"] });
      setName("");
      setCode("");
      setResultScope("other");
      toast({ title: "Department created", description: `${created.name} (${created.code})` });
    },
    onError: (err: unknown) => {
      const message =
        err && typeof err === "object" && "data" in err
          ? String((err as { data?: { error?: string } }).data?.error ?? "Could not create department")
          : "Could not create department";
      toast({ title: message, variant: "destructive" });
    },
  });

  const toggle = useMutation({
    mutationFn: (row: Department) => updateDepartment(row.id, { isActive: !row.isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-departments"] });
      await queryClient.invalidateQueries({ queryKey: ["active-departments"] });
      toast({ title: "Department updated" });
    },
    onError: () => toast({ title: "Could not update department", variant: "destructive" }),
  });

  return (
    <AdminLayout
      title="Departments"
      subtitle="Add hospital departments used for staff accounts and staff login. Codes are stored on the user role for access control."
    >
      <AdminCard className="mb-4 p-5">
        <h2 className="text-sm font-semibold text-[#153D2B]">Add department</h2>
        <form
          className="mt-3 grid gap-3 md:grid-cols-[1.4fr_1fr_1.2fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) {
              toast({ title: "Department name is required", variant: "destructive" });
              return;
            }
            create.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-[#17221D]">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Pharmacy"
              className="border-[#DDE5E0]"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-[#17221D]">Code (optional)</span>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="auto from name"
              className="border-[#DDE5E0]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-[#17221D]">Result scope</span>
            <select
              className="h-10 w-full rounded-md border border-[#DDE5E0] bg-white px-3 text-sm"
              value={resultScope}
              onChange={(event) => setResultScope(event.target.value as Department["resultScope"])}
            >
              {SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {create.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
        <p className="mt-2 text-[11px] text-[#66756C]">
          If code is blank, it is generated from the name. Apply{" "}
          <code className="rounded bg-[#F3F6F4] px-1">006_create_departments.sql</code> once if this page errors.
        </p>
      </AdminCard>

      <AdminCard className="overflow-hidden">
        <div className="border-b border-[#E8EEEA] px-5 py-3">
          <h2 className="text-sm font-semibold text-[#153D2B]">All departments</h2>
        </div>
        {isLoading ? <p className="px-5 py-6 text-sm text-[#66756C]">Loading…</p> : null}
        {isError ? (
          <p className="px-5 py-6 text-sm text-[#8E3344]">
            Could not load departments. Confirm the API is running and{" "}
            <code className="rounded bg-[#F3F6F4] px-1">006_create_departments.sql</code> has been applied.
          </p>
        ) : null}
        {!isLoading && !isError ? (
          <AdminTable headers={["Name", "Code", "Result scope", "Status", ""]}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#66756C]">
                  No departments yet. Add one above.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-[#E8EEEA]">
                  <td className="px-4 py-3 font-medium text-[#153D2B]">{row.name}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#66756C]">{row.code}</td>
                  <td className="px-4 py-3 text-sm text-[#66756C]">{row.resultScope}</td>
                  <td className="px-4 py-3">
                    <StatusPill active={row.isActive} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-md border border-[#DDE5E0] px-2.5 py-1.5 text-[12px] font-semibold text-[#0F3D2E]"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(row)}
                    >
                      {row.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </AdminTable>
        ) : null}
      </AdminCard>
    </AdminLayout>
  );
}
