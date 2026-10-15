import { useState } from "react";
import { useChangePassword } from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", medical_records: "Medical Records",
  laboratory: "Laboratory Staff", radiology: "Radiology Staff", physician: "Authorized Physician",
};

export default function SettingsPage() {
  const { auth } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  const changePassword = useChangePassword();

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (form.newPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    changePassword.mutate(
      { data: { currentPassword: form.currentPassword, newPassword: form.newPassword } },
      {
        onSuccess: () => {
          toast({ title: "Password updated successfully" });
          setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Failed to change password", variant: "destructive" });
        },
      }
    );
  };

  return (
    <StaffLayout title="Settings">
      <div className="w-full max-w-3xl space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-primary">Settings</h2>
          <p className="text-muted-foreground">Manage your account preferences</p>
        </div>

        {/* Account Info */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="font-semibold">Account Information</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Full Name</p>
              <p className="font-medium">{auth.user?.firstName} {auth.user?.lastName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Username</p>
              <p className="font-medium font-mono">{auth.user?.username}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium">{auth.user?.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p className="font-medium">{ROLE_LABELS[auth.user?.role ?? ""] ?? auth.user?.role}</p>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="font-semibold mb-4">Change Password</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPw">Current Password</Label>
              <PasswordInput id="currentPw" {...field("currentPassword")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPw">New Password</Label>
              <PasswordInput id="newPw" {...field("newPassword")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPw">Confirm New Password</Label>
              <PasswordInput id="confirmPw" {...field("confirmPassword")} />
            </div>
            <Button type="submit" disabled={changePassword.isPending} className="w-full">
              {changePassword.isPending ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </div>
      </div>
    </StaffLayout>
  );
}
