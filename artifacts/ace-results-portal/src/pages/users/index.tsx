import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListUsers,
  getListUsersQueryKey,
  useDeleteUser,
} from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Plus, ShieldOff } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  medical_records: "Medical Records",
  laboratory: "Laboratory Staff",
  radiology: "Radiology Staff",
  physician: "Authorized Physician",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-800",
  medical_records: "bg-blue-100 text-blue-800",
  laboratory: "bg-teal-100 text-teal-800",
  radiology: "bg-purple-100 text-purple-800",
  physician: "bg-green-100 text-green-800",
};

export default function UsersPage() {
  const [, setLocation] = useLocation();
  const { auth } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useListUsers(
    { page, limit: 20 },
    { query: { queryKey: getListUsersQueryKey({ page, limit: 20 }) } }
  );

  const deactivate = useDeleteUser();

  if (auth.user?.role !== "super_admin") {
    return (
      <StaffLayout>
        <div className="text-center py-16">
          <p className="text-xl font-semibold text-destructive">Access Denied</p>
          <p className="text-muted-foreground mt-2">Only Super Admins can manage staff users.</p>
        </div>
      </StaffLayout>
    );
  }

  const users = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const handleDeactivate = (id: number, username: string) => {
    if (!confirm(`Deactivate user "${username}"?`)) return;
    deactivate.mutate({ id }, {
      onSuccess: () => { toast({ title: `User ${username} deactivated` }); refetch(); },
      onError: () => toast({ title: "Failed to deactivate user", variant: "destructive" }),
    });
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-primary">Staff Users</h2>
            <p className="text-muted-foreground">Manage hospital staff accounts and permissions</p>
          </div>
          <Button onClick={() => setLocation("/users/new")}>
            <Plus className="w-4 h-4 mr-2" />Add User
          </Button>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">No users found.</p>
              <Button className="mt-4" onClick={() => setLocation("/users/new")}>
                <Plus className="w-4 h-4 mr-2" />Add User
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Username</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Full Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Last Login</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-sm font-medium">{u.username}</td>
                    <td className="px-4 py-3">{u.firstName} {u.lastName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${ROLE_COLORS[u.role] ?? "bg-gray-100 text-gray-700"}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${u.isActive ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("en-PH") : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {u.isActive && u.id !== auth.user?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => handleDeactivate(u.id, u.username)}
                            disabled={deactivate.isPending}
                          >
                            <ShieldOff className="w-4 h-4 mr-1" />Deactivate
                          </Button>
                        )}
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
            <p className="text-sm text-muted-foreground">Showing {users.length} of {total} users</p>
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
