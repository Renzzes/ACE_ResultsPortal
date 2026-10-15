import { useRef, useState } from "react";
import { useChangePassword } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { doctorInitials, useDoctorPhoto } from "@/lib/doctor-photo";
import { Camera, Lock, User } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";

export function PhysicianSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const changePwMutation = useChangePassword();
  const user = auth.user;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { photo, savePhoto } = useDoctorPhoto(user?.id);
  const initials = doctorInitials(user?.firstName, user?.lastName);

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await savePhoto(file);
      toast({ title: "Profile photo updated" });
    } catch (err) {
      toast({
        title: "Could not update photo",
        description: err instanceof Error ? err.message : "Please try another image.",
        variant: "destructive",
      });
    }
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    changePwMutation.mutate(
      { data: { currentPassword, newPassword } },
      {
        onSuccess: () => {
          toast({ title: "Password changed successfully" });
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
        onError: (err: unknown) => {
          const message = err && typeof err === "object" && "message" in err ? String((err as { message?: string }).message) : "Please try again.";
          toast({
            title: "Failed to change password",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="doctor-shell max-w-2xl max-h-[90vh] overflow-y-auto bg-[hsl(var(--doc-card))] text-[hsl(var(--doc-text))] border-[hsl(var(--doc-border))] sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[hsl(var(--doc-text))]">Settings</DialogTitle>
          <DialogDescription className="doc-muted">
            Manage your physician account details and password.
          </DialogDescription>
        </DialogHeader>

        <section className="rounded-2xl border border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-elevated))] p-4 sm:p-5">
          <h3 className="font-semibold text-[hsl(var(--doc-text))] mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[hsl(var(--doc-green))] hover:opacity-80"
              aria-label="Change profile photo"
              title="Change profile photo"
            >
              <User className="w-4 h-4" />
            </button>
            Profile Information
          </h3>
          <div className="flex justify-center mb-5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={handlePhotoChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative group w-24 h-24 rounded-full ring-4 ring-[hsl(var(--doc-green))]/15 overflow-hidden bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]"
              aria-label="Change profile photo"
              title="Change profile photo"
            >
              {photo ? (
                <img src={photo} alt="Doctor profile" className="w-full h-full object-cover" />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-2xl font-bold">{initials}</span>
              )}
              <span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="w-6 h-6 text-white" />
              </span>
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoField label="Full Name" value={`Dr. ${user?.firstName} ${user?.lastName}`} />
            <InfoField label="Username" value={user?.username} />
            <InfoField label="Email" value={user?.email || "Not set"} />
            <InfoField label="Role" value={user?.role?.replace("_", " ")} />
            <InfoField label="Account Created" value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-PH") : "—"} />
            <InfoField label="Last Login" value={user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("en-PH") : "—"} />
          </div>
        </section>

        <section className="rounded-2xl border border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-elevated))] p-4 sm:p-5">
          <h3 className="font-semibold text-[hsl(var(--doc-text))] mb-4 flex items-center gap-2">
            <Lock className="w-4 h-4 text-[hsl(var(--doc-green))]" /> Change Password
          </h3>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--doc-text))] mb-1">Current Password</label>
              <PasswordInput
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="bg-[hsl(var(--doc-card))] border-[hsl(var(--doc-border))]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--doc-text))] mb-1">New Password</label>
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="bg-[hsl(var(--doc-card))] border-[hsl(var(--doc-border))]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--doc-text))] mb-1">Confirm New Password</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="bg-[hsl(var(--doc-card))] border-[hsl(var(--doc-border))]"
              />
            </div>
            <Button
              type="submit"
              disabled={changePwMutation.isPending}
              className="bg-[hsl(var(--doc-green))] hover:bg-[hsl(var(--doc-green-bright))] text-white"
            >
              {changePwMutation.isPending ? "Changing..." : "Change Password"}
            </Button>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function InfoField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs doc-muted">{label}</p>
      <p className="text-sm font-medium text-[hsl(var(--doc-text))] capitalize break-words">{value ?? "—"}</p>
    </div>
  );
}
