import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const fieldClass =
  "h-12 rounded-md border-gray-200 bg-white text-[15px] placeholder:text-gray-400 focus-visible:ring-[#97ab96]";

export default function PortalChangePasswordPage() {
  const [, setLocation] = useLocation();
  const { portalAuth, portalLogout } = useAuth();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/portal/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(portalAuth.token ? { Authorization: `Bearer ${portalAuth.token}` } : {}),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not update password.");
        return;
      }
      toast({
        title: "Password updated",
        description: "Sign in again with your new password.",
      });
      portalLogout();
      setLocation("/login");
    } catch {
      setError("Could not update password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!portalAuth.token) setLocation("/login");
  }, [portalAuth.token, setLocation]);

  if (!portalAuth.token) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f3f4f6] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Set a new password</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your account requires a new password before you can access Patient Portal features.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword" className="font-semibold text-gray-900">
              Temporary / current password
            </Label>
            <PasswordInput
              id="currentPassword"
              className={fieldClass}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword" className="font-semibold text-gray-900">
              New password
            </Label>
            <PasswordInput
              id="newPassword"
              className={fieldClass}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword" className="font-semibold text-gray-900">
              Confirm new password
            </Label>
            <PasswordInput
              id="confirmPassword"
              className={fieldClass}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button
            type="submit"
            disabled={busy}
            className="h-12 w-full rounded-md border-0 bg-[#2f5d38] font-semibold text-white hover:bg-[#254a2d]"
          >
            {busy ? "Saving…" : "Save new password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
