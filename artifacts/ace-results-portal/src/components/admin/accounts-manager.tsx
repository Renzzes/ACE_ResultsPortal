import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getListUsersQueryKey,
  useCreateUser,
  useDeleteUser,
  useListUsers,
  useResetUserPassword,
  useUpdateUser,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { AccountFormDialog, PasswordDialog, emptyAccountForm, type AccountForm } from "@/components/admin/account-dialog";
import { AdminCard, AdminTable, RolePill, StatusPill } from "@/components/admin/shared";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { fetchActiveDepartments } from "@/lib/admin-api";
import {
  ADMIN_ROLE_LABELS,
  adminDisplayName,
  type AdminAccount,
} from "@/lib/admin-mock-data";
import { passwordResetErrorMessage } from "@/lib/workflow-stability";
import { KeyRound, Pencil, Plus, ShieldOff, ShieldCheck } from "lucide-react";

type Kind = "staff" | "doctor";

const ACCOUNT_STATUS_ROLES = new Set([
  "laboratory",
  "radiology",
  "endoscopy",
  "medical_records",
  "physician",
]);

function toAccount(user: {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}): AdminAccount {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email ?? "",
    role: user.role as AdminAccount["role"],
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

export function AccountsManager({ kind }: { kind: Kind }) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [form, setForm] = useState(emptyAccountForm(kind === "doctor" ? "physician" : ""));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [passwordFor, setPasswordFor] = useState<AdminAccount | null>(null);
  const [statusFor, setStatusFor] = useState<AdminAccount | null>(null);

  const { data: departmentsData } = useQuery({
    queryKey: ["active-departments"],
    queryFn: fetchActiveDepartments,
    enabled: kind === "staff",
  });

  const departmentOptions = useMemo(() => {
    const depts = (departmentsData?.data ?? []).map((d) => ({ value: d.code, label: d.name }));
    return [{ value: "super_admin", label: "Administrator" }, ...depts];
  }, [departmentsData]);

  const defaultStaffRole = departmentOptions.find((d) => d.value !== "super_admin")?.value ?? "super_admin";

  const params = {
    page,
    limit: 20,
    search: search || undefined,
    role: kind === "doctor" ? "physician" : undefined,
  };
  const { data, isLoading, refetch } = useListUsers(params, {
    query: { queryKey: getListUsersQueryKey(params) },
  });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deactivate = useDeleteUser();
  const queryClient = useQueryClient();
  const resetPassword = useResetUserPassword();
  const resetStoredPassword = resetPassword.reset;

  useEffect(() => {
    if (passwordFor) return;
    resetStoredPassword();
    const cache = queryClient.getMutationCache();
    for (const mutation of cache.findAll({ mutationKey: ["resetUserPassword"] })) {
      if (mutation.state.variables != null) cache.remove(mutation);
    }
  }, [passwordFor, queryClient, resetStoredPassword]);

  const live = useMemo(() => {
    const rows = (data?.data ?? []).map(toAccount);
    return kind === "staff"
      ? rows.filter((row) => row.role !== "physician" && row.role !== "patient")
      : rows.filter((row) => row.role === "physician");
  }, [data, kind]);

  const accounts = live;
  const title = kind === "staff" ? "Staff accounts" : "Doctor accounts";
  const noun = kind === "staff" ? "staff" : "doctor";
  const roleLabels = useMemo(() => {
    const map: Record<string, string> = { ...ADMIN_ROLE_LABELS };
    for (const opt of departmentOptions) map[opt.value] = opt.label;
    return map;
  }, [departmentOptions]);

  function openCreate() {
    setFormMode("create");
    setEditingId(null);
    setForm(emptyAccountForm(kind === "doctor" ? "physician" : defaultStaffRole));
    setFormOpen(true);
  }

  function openEdit(account: AdminAccount) {
    setFormMode("edit");
    setEditingId(account.id);
    setForm({
      firstName: account.firstName,
      lastName: account.lastName,
      username: account.username,
      email: account.email,
      role: account.role,
      password: "",
    });
    setFormOpen(true);
  }

  function apiErrorMessage(err: unknown, fallback: string) {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { error?: string } }).data;
      if (data?.error) return data.error;
    }
    if (err instanceof Error && err.message) return err.message;
    return fallback;
  }

  function onSave(next: AccountForm) {
    if (formMode === "create") {
      const username = next.username.trim();
      const password = next.password;
      if (username.length < 3) {
        toast({ title: "Username must be at least 3 characters", variant: "destructive" });
        return;
      }
      if (password.length < 8) {
        toast({ title: "Password must be at least 8 characters", variant: "destructive" });
        return;
      }
      createUser.mutate(
        {
          data: {
            username,
            password,
            firstName: next.firstName.trim(),
            lastName: next.lastName.trim(),
            email: next.email.trim() || undefined,
            role: (kind === "doctor" ? "physician" : next.role) as import("@workspace/api-client-react").UserInput["role"],
          },
        },
        {
          onSuccess: () => {
            toast({ title: `${kind === "staff" ? "Staff" : "Doctor"} account created` });
            setFormOpen(false);
            void refetch();
          },
          onError: (err) =>
            toast({
              title: apiErrorMessage(err, "Could not create account"),
              variant: "destructive",
            }),
        },
      );
      return;
    }
    if (editingId == null) return;
    updateUser.mutate(
      {
        id: editingId,
        data: {
          firstName: next.firstName,
          lastName: next.lastName,
          email: next.email || null,
          role: (kind === "doctor" ? "physician" : next.role) as import("@workspace/api-client-react").UserUpdate["role"],
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Account updated" });
          setFormOpen(false);
          void refetch();
        },
        onError: () => toast({ title: "Could not update account", variant: "destructive" }),
      },
    );
  }

  function onToggle(account: AdminAccount) {
    if (account.id === auth.user?.id) {
      toast({ title: "You cannot deactivate your own account", variant: "destructive" });
      return;
    }
    if (!ACCOUNT_STATUS_ROLES.has(account.role)) {
      toast({ title: "Status changes apply to staff and doctor accounts", variant: "destructive" });
      return;
    }
    setStatusFor(account);
  }

  function confirmStatusChange() {
    const account = statusFor;
    if (!account) return;
    if (account.isActive) {
      deactivate.mutate(
        { id: account.id },
        {
          onSuccess: () => {
            toast({ title: `${account.username} deactivated` });
            setStatusFor(null);
            void refetch();
          },
          onError: () => toast({ title: "Could not deactivate account", variant: "destructive" }),
        },
      );
      return;
    }
    updateUser.mutate(
      { id: account.id, data: { isActive: true } },
      {
        onSuccess: () => {
          toast({ title: `${account.username} reactivated` });
          setStatusFor(null);
          void refetch();
        },
        onError: () => toast({ title: "Could not reactivate account", variant: "destructive" }),
      },
    );
  }

  function onResetPassword(password: string) {
    if (!passwordFor) return;
    resetPassword.mutate(
      { id: passwordFor.id, data: { newPassword: password } },
      {
        onSuccess: () => {
          toast({ title: `Password reset for ${passwordFor.username}` });
          setPasswordFor(null);
        },
        onError: (err) => {
          const serverMessage =
            err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data
              ? String((err.data as { error?: unknown }).error ?? "")
              : undefined;
          toast({
            title: passwordResetErrorMessage({
              status: err instanceof ApiError ? err.status : undefined,
              serverMessage,
              submittedPassword: password,
            }),
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <AdminLayout title={title} fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#64706A]">
            Create, edit, deactivate, and reset passwords for {noun} accounts.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={`Search ${noun}s…`}
              className="w-full border-[#DDE5E0] bg-white sm:w-64"
            />
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2F7D4A] px-3 py-2 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Add {noun}
            </button>
          </div>
        </div>

        <AdminCard className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AdminTable
            headers={["Name", "Username", "Email", kind === "staff" ? "Role" : "Type", "Status", "Last login", ""]}
            loading={isLoading && accounts.length === 0}
            empty={!isLoading && accounts.length === 0 ? `No ${noun} accounts found.` : undefined}
          >
            {accounts.map((account) => (
              <tr key={account.id} className="hover:bg-[#F6F4EF]/80">
                <td className="px-4 py-3 font-semibold text-[#17221D]">{adminDisplayName(account)}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#64706A]">{account.username}</td>
                <td className="px-4 py-3 text-[#64706A]">{account.email || "—"}</td>
                <td className="px-4 py-3">
                  <RolePill role={account.role} label={kind === "doctor" ? "Physician" : roleLabels[account.role] ?? account.role} />
                </td>
                <td className="px-4 py-3">
                  <StatusPill active={account.isActive} />
                </td>
                <td className="px-4 py-3 text-[#64706A]">
                  {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString("en-PH") : "Never"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <IconButton label="Edit" onClick={() => openEdit(account)}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Reset password" onClick={() => setPasswordFor(account)}>
                      <KeyRound className="h-4 w-4" />
                    </IconButton>
                    {ACCOUNT_STATUS_ROLES.has(account.role) ? (
                      <IconButton
                        label={account.isActive ? "Deactivate" : "Activate"}
                        onClick={() => onToggle(account)}
                      >
                        {account.isActive ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                      </IconButton>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>

        {data && data.total > 20 && live.length > 0 ? (
          <div className="flex items-center justify-between text-sm text-[#64706A]">
            <p>
              Page {page} of {Math.ceil(data.total / 20)}
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[#DDE5E0] bg-white px-3 py-1.5 disabled:opacity-40">
                Previous
              </button>
              <button type="button" disabled={page * 20 >= data.total} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[#DDE5E0] bg-white px-3 py-1.5 disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <AccountFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={formMode === "create" ? `New ${noun}` : `Edit ${noun}`}
        description={
          kind === "staff"
            ? "Pick a department from Admin → Departments, or Administrator for system access."
            : "Physician accounts used for the doctor dashboard."
        }
        mode={formMode}
        kind={kind}
        initial={form}
        pending={createUser.isPending || updateUser.isPending}
        departmentOptions={departmentOptions}
        onSubmit={onSave}
      />
      <PasswordDialog
        open={Boolean(passwordFor)}
        onOpenChange={(open) => {
          if (!open) setPasswordFor(null);
        }}
        title={`Reset password · ${passwordFor?.username ?? ""}`}
        description="This replaces the current password immediately."
        pending={resetPassword.isPending}
        onSubmit={onResetPassword}
      />
      <AlertDialog open={Boolean(statusFor)} onOpenChange={(open) => { if (!open) setStatusFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusFor?.isActive ? "Deactivate this account?" : "Activate this account?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusFor?.isActive
                ? `${statusFor.username} will not be able to sign in until the account is activated again.`
                : `${statusFor?.username ?? "This account"} can sign in again with the existing password.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivate.isPending || updateUser.isPending}>Cancel</AlertDialogCancel>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-md bg-[#2F7D4A] px-4 text-sm font-semibold text-white hover:bg-[#25653C] disabled:opacity-50"
              disabled={deactivate.isPending || updateUser.isPending}
              onClick={confirmStatusChange}
            >
              {deactivate.isPending || updateUser.isPending
                ? "Saving…"
                : statusFor?.isActive
                  ? "Deactivate"
                  : "Activate"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-lg p-1.5 text-[#64706A] hover:bg-[#F6F4EF] hover:text-[#153D2B]"
    >
      {children}
    </button>
  );
}
