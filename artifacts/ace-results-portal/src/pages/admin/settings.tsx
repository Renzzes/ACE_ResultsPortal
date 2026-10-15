import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { getGetAdminOverviewQueryKey, useChangePassword, useGetAdminOverview } from "@workspace/api-client-react";
import { useAuth, useAuthoritativeRole } from "@/lib/auth";
import { mayRequestAdminOverview } from "@/lib/workflow-stability";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/hooks/use-toast";

const SECTIONS = ["General", "Security", "Authentication", "Storage", "Notifications", "System"] as const;

function sectionFromSearch(search: string): (typeof SECTIONS)[number] | null {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("section");
  return SECTIONS.find((item) => item === value) ?? null;
}

function formatGb(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0 GB";
  if (value < 0.001) return `${(value * 1024 * 1024).toFixed(0)} KB`;
  if (value < 1) return `${(value * 1024).toFixed(1)} MB`;
  return `${value.toFixed(2)} GB`;
}

export default function AdminSettingsPage() {
  const { auth } = useAuth();
  const { toast } = useToast();
  const search = useSearch();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>(() => sectionFromSearch(search) ?? "General");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const changePassword = useChangePassword();
  const role = useAuthoritativeRole();
  const { data: overview, isLoading: storageLoading, isError: storageError } = useGetAdminOverview({
    query: { queryKey: getGetAdminOverviewQueryKey(), enabled: mayRequestAdminOverview(role) },
  });
  const storage = overview?.storage;

  useEffect(() => {
    const next = sectionFromSearch(search);
    if (next) setSection(next);
  }, [search]);

  return (
    <AdminLayout title="Settings" subtitle="Hospital configuration. Secrets such as JWT and database passwords are not shown.">
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="ad-card h-fit space-y-1 rounded-xl p-2">
          {SECTIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSection(item)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${
                section === item ? "bg-[#EAF5EE] text-[#0F3D2E]" : "text-[#66756C] hover:bg-[#F7F8F5]"
              }`}
            >
              {item}
            </button>
          ))}
        </aside>
        <section className="ad-card rounded-xl p-5">
          {section === "General" ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Hospital" value="ACE Medical Center Cebu" />
              <Field label="Environment" value={import.meta.env.PROD ? "Production" : "Development"} />
              <Field
                label="Administrator"
                value={`${auth.user?.firstName ?? ""} ${auth.user?.lastName ?? ""}`.trim() || auth.user?.username || "Admin"}
              />
              <Field label="Username" value={auth.user?.username ?? "—"} />
            </dl>
          ) : null}
          {section === "Security" || section === "Authentication" ? (
            <form
              className="max-w-md space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (newPassword.length < 8) {
                  toast({ title: "Password must be at least 8 characters", variant: "destructive" });
                  return;
                }
                changePassword.mutate(
                  { data: { currentPassword, newPassword } },
                  {
                    onSuccess: () => {
                      toast({ title: "Password changed successfully" });
                      setCurrentPassword("");
                      setNewPassword("");
                    },
                    onError: () => toast({ title: "Could not change password", variant: "destructive" }),
                  },
                );
              }}
            >
              <p className="text-sm text-[#66756C]">
                Change your administrator password. JWT secrets and database credentials stay on the server.
              </p>
              <label className="block text-sm">
                Current password
                <PasswordInput
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="mt-1 border-[#E3E8E4]"
                />
              </label>
              <label className="block text-sm">
                New password
                <PasswordInput
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="mt-1 border-[#E3E8E4]"
                />
              </label>
              <button type="submit" className="rounded-lg bg-[#0F3D2E] px-4 py-2 text-sm font-semibold text-white">
                Update password
              </button>
            </form>
          ) : null}
          {section === "Storage" ? (
            <div className="space-y-4 text-sm text-[#66756C]">
              <p>
                Live ACE_ResultsPortal database allocation from the storage audit API. Filesystem roots are not exposed.
              </p>
              {storageLoading ? <p>Loading storage…</p> : null}
              {storageError || !storage?.available ? (
                <p className="text-[#8B3A46]">Storage information unavailable.</p>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Field label="Database" value={storage.databaseName} />
                  <Field label="Allocated" value={formatGb(storage.databaseAllocatedGB)} />
                  <Field label="Used %" value={`${storage.databaseUsedPercent ?? 0}%`} />
                  <Field
                    label="Used"
                    value={formatGb((storage.databaseDataUsedGB ?? 0) + (storage.logUsedGB ?? 0))}
                  />
                  <Field label="Normal" value="Below 70%" />
                  <Field label="Warning" value="70–85%" />
                  <Field label="Critical" value="Above 85%" />
                  <Field label="Filesystem root" value="Not exposed in this UI" />
                </dl>
              )}
              <p>Threshold labels are informational and do not change server behavior.</p>
            </div>
          ) : null}
          {section === "Notifications" ? (
            <p className="text-sm text-[#66756C]">
              Header and Notifications page alerts are derived from pending results, access_denied audit events, and
              ACE_ResultsPortal storage usage. They are not mock records.
            </p>
          ) : null}
          {section === "System" ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Application" value="ACE Results Portal" />
              <Field label="API health" value="/api/healthz" />
              <Field label="Role" value={auth.user?.role ?? "super_admin"} />
              <Field label="Secrets" value="Not exposed in this UI" />
            </dl>
          ) : null}
        </section>
      </div>
    </AdminLayout>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[#66756C]">{label}</dt>
      <dd className="mt-1 font-semibold text-[#17251E]">{value}</dd>
    </div>
  );
}
