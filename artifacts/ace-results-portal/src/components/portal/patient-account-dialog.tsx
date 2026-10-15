import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  getGetPortalOverviewQueryKey,
  getGetPortalProfileQueryKey,
  useGetPortalProfile,
  usePatchPortalProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PatientProfileAvatar } from "@/components/portal/patient-profile-avatar";
import { useToast } from "@/hooks/use-toast";
import { revokeCurrentTabSession, useAuth } from "@/lib/auth";
import { portalFullName, portalPhotoKey } from "@/lib/patient-identity";
import { KeyRound, LogOut, Mail, Phone, Shield } from "lucide-react";

export function PatientAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { portalAuth, portalLogout } = useAuth();
  const profileQuery = useGetPortalProfile({
    query: {
      queryKey: getGetPortalProfileQueryKey(),
      enabled: open && Boolean(portalAuth.token),
    },
  });
  const patchMut = usePatchPortalProfile();

  const profile = profileQuery.data;
  const fallback = portalAuth.patient;
  const firstName = profile?.firstName ?? fallback?.firstName;
  const lastName = profile?.lastName ?? fallback?.lastName;
  const middleName = profile?.middleName ?? fallback?.middleName ?? null;
  const patientHisId = profile?.patientHisId ?? fallback?.patientHisId;
  const dateOfBirth = profile?.dateOfBirth ?? fallback?.dateOfBirth;
  const fullName = portalFullName({ firstName, middleName, lastName });
  const photoKey = portalPhotoKey(patientHisId, fallback?.id);

  const [email, setEmail] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");

  useEffect(() => {
    if (!profile) return;
    setEmail(profile.email ?? "");
    setMobileNumber(profile.mobileNumber ?? "");
  }, [profile]);

  async function onSaveContact(event: FormEvent) {
    event.preventDefault();
    if (patchMut.isPending) return;
    try {
      const updated = await patchMut.mutateAsync({
        data: {
          email: email.trim(),
          mobileNumber: mobileNumber.trim() ? mobileNumber.trim() : null,
        },
      });
      setEmail(updated.email ?? "");
      setMobileNumber(updated.mobileNumber ?? "");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetPortalProfileQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetPortalOverviewQueryKey() }),
      ]);
      toast({ title: "Contact information updated" });
    } catch {
      toast({
        title: "Unable to save changes",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  }

  function onLogout() {
    void revokeCurrentTabSession().finally(() => {
      portalLogout();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ace-scroll max-h-[90vh] w-[min(96vw,36rem)] max-w-xl overflow-y-auto p-0 sm:rounded-2xl">
        <DialogHeader className="border-b border-[#DDE5E0] px-5 py-4 text-left">
          <DialogTitle className="text-[#153D2B]">Account</DialogTitle>
          <DialogDescription className="text-[#64706A]">
            View your hospital record and update portal contact details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 p-5">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-[#F6F9F7] px-4 py-5">
            <PatientProfileAvatar
              patientId={photoKey}
              firstName={firstName}
              lastName={lastName}
              fullName={fullName}
              size="dashboard"
              editable
            />
            <div className="text-center">
              <p className="text-lg font-bold text-[#153D2B]">{fullName || "Patient"}</p>
              <p className="mt-1 text-[13px] text-[#64706A]">
                {patientHisId ? `Patient ID ${patientHisId}` : "Patient portal"}
              </p>
              <p className="mt-2 text-[12px] text-[#64706A]">
                Profile photo is stored on this device only and is not saved to the hospital system.
              </p>
            </div>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#64706A]">
                Hospital record
              </h3>
              <span className="rounded bg-[#E8EEEA] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#64706A]">
                Read only
              </span>
            </div>
            <p className="mb-3 text-[12px] leading-relaxed text-[#64706A]">
              Some information is maintained from your hospital record and cannot be changed from the
              Patient Portal. Please contact Medical Records if you need to correct it.
            </p>
            {profileQuery.isLoading ? (
              <p className="text-sm text-[#64706A]">Loading…</p>
            ) : profileQuery.isError ? (
              <p className="text-sm text-[#64706A]">Unable to load your information. Please try again.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[#DDE5E0] bg-[#FBFCFB] p-3">
                <Cell label="Patient ID" value={patientHisId || "—"} />
                <Cell label="Date of birth" value={dateOfBirth || "—"} />
                <Cell label="First name" value={firstName || "—"} />
                <Cell label="Middle name" value={middleName || "—"} />
                <Cell label="Last name" value={lastName || "—"} />
              </dl>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#64706A]">
                Contact information
              </h3>
              <span className="rounded bg-[#E7F3EC] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2F7D4A]">
                Editable
              </span>
            </div>
            <form onSubmit={(event) => void onSaveContact(event)} className="space-y-3">
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-[#17221D]">
                  <Mail className="h-3.5 w-3.5 text-[#2F7D4A]" />
                  Email
                </span>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={255}
                  autoComplete="email"
                  className="border-[#DDE5E0]"
                  disabled={profileQuery.isLoading || profileQuery.isError}
                />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-[#17221D]">
                  <Phone className="h-3.5 w-3.5 text-[#2F7D4A]" />
                  Mobile number
                </span>
                <Input
                  type="tel"
                  value={mobileNumber}
                  onChange={(event) => setMobileNumber(event.target.value)}
                  maxLength={32}
                  autoComplete="tel"
                  className="border-[#DDE5E0]"
                  disabled={profileQuery.isLoading || profileQuery.isError}
                />
              </label>
              <button
                type="submit"
                disabled={
                  patchMut.isPending || profileQuery.isLoading || profileQuery.isError || !email.trim()
                }
                className="w-full rounded-lg bg-[#2F7D4A] py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {patchMut.isPending ? "Saving…" : "Save contact information"}
              </button>
            </form>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#64706A]">
              <Shield className="h-3.5 w-3.5 text-[#2F7D4A]" />
              Account &amp; security
            </h3>
            <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-3">
              <Cell label="Portal status" value={profile?.accountStatus === "active" ? "Active" : "—"} />
              <Cell
                label="Last login"
                value={
                  profile?.lastLoginAt
                    ? new Date(profile.lastLoginAt).toLocaleString()
                    : "—"
                }
              />
            </dl>
            <div className="space-y-2">
              <Link
                href="/recover"
                onClick={() => onOpenChange(false)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#DDE5E0] bg-white py-2 text-sm font-semibold text-[#153D2B] hover:bg-[#F6F9F7]"
              >
                <KeyRound className="h-4 w-4 text-[#2F7D4A]" />
                Forgot password
              </Link>
              <p className="text-[11px] leading-relaxed text-[#64706A]">
                Portal sign-in uses your Hospital Patient ID and password. Use recovery to reset your
                password at your registered portal email. Your access code is only needed to view results.
              </p>
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#E8C9C9] bg-[#FFF8F8] py-2 text-sm font-semibold text-[#8B2E2E] hover:bg-[#FFF1F1]"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[#64706A]">{label}</dt>
      <dd className="mt-0.5 break-all text-[13px] font-semibold text-[#17221D]">{value}</dd>
    </div>
  );
}
