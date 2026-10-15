import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";

const fieldClass =
  "h-12 w-full rounded-md border-gray-200 bg-white text-[15px] placeholder:text-gray-400 focus-visible:ring-[#97ab96]";

const primaryBtn =
  "h-12 w-full rounded-md border-0 bg-[#2f5d38] text-base font-semibold text-white hover:bg-[#254a2d]";

const sageBtn =
  "h-12 w-full rounded-md border-0 bg-[#97ab96] text-base font-semibold text-white hover:bg-[#879c86]";

const patientSteps = ["Verify Record", "Verify Email", "Set Password", "Complete"] as const;

function RequiredLabel({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return (
    <Label htmlFor={htmlFor} className="text-[15px] font-semibold text-gray-900">
      {children}
      <span className="ml-0.5 text-red-500">*</span>
    </Label>
  );
}

function RecoveryStepper({ current }: { current: number }) {
  return (
    <ol className="mt-6 flex w-full overflow-x-auto pb-1">
      {patientSteps.map((label, index) => {
        const active = index === current;
        const isFirst = index === 0;
        const isLast = index === patientSteps.length - 1;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={`relative flex min-w-[8.25rem] flex-1 items-center justify-center whitespace-nowrap px-6 py-3 text-sm font-semibold ${
              active ? "bg-[#2f5d38] text-white" : "bg-[#e5e7eb] text-gray-500"
            }`}
            style={{
              clipPath: isFirst
                ? "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)"
                : isLast
                  ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 14px 50%)"
                  : "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)",
              marginLeft: isFirst ? 0 : -10,
            }}
          >
            {index + 1}. {label}
          </li>
        );
      })}
    </ol>
  );
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

function readError(data: Record<string, unknown>, fallback: string): string {
  if (typeof data.error === "string") return data.error;
  if (typeof data.message === "string") return data.message;
  return fallback;
}

function PatientRecovery() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [assistedMessage, setAssistedMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ patientHisId: "", lastName: "", dateOfBirth: "" });
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!form.patientHisId.trim() || !form.lastName.trim() || !form.dateOfBirth) {
      setError("Please complete all required fields.");
      return;
    }

    setBusy(true);
    try {
      const result = await postJson("/api/portal/recover/request", {
        patientHisId: form.patientHisId.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth.trim(),
      });

      if (result.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      if (result.status === 503) {
        setError(readError(result.data, "Recovery is temporarily unavailable. Please try again later."));
        return;
      }
      if (result.status === 401) {
        setError(readError(result.data, "Patient information could not be verified."));
        return;
      }

      if (result.data.assistedRecovery === true) {
        setAssistedMessage(
          typeof result.data.message === "string"
            ? result.data.message
            : "Please contact ACE Medical Center Cebu for assisted recovery.",
        );
        return;
      }

      if (typeof result.data.recoveryToken === "string") {
        setRecoveryToken(result.data.recoveryToken);
        setMaskedEmail(typeof result.data.maskedEmail === "string" ? result.data.maskedEmail : null);
        setAssistedMessage(null);
        setStep(1);
        toast({
          title: "Verification code sent",
          description: "Check your registered portal email for a 6-digit code.",
        });
        return;
      }

      setError(
        typeof result.data.message === "string"
          ? result.data.message
          : "Your hospital record was verified, but there is no Patient Portal login for this record yet. Register for the Patient Portal before resetting a password.",
      );
    } catch {
      setError("Recovery is temporarily unavailable. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmOtp(event: FormEvent) {
    event.preventDefault();
    if (!recoveryToken || otp.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const result = await postJson("/api/portal/recover/verify", { recoveryToken, otp });
      if (result.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      if (!result.ok || result.data.verified !== true) {
        setError(readError(result.data, "Invalid verification code."));
        return;
      }
      setStep(2);
    } catch {
      setError("Recovery is temporarily unavailable. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function onResetPassword(event: FormEvent) {
    event.preventDefault();
    if (!recoveryToken || otp.length !== 6) {
      setError("Recovery verification has expired. Please start again.");
      setStep(0);
      return;
    }
    const { newPassword, confirmPassword } = passwordForm;
    if (!newPassword || newPassword !== confirmPassword) {
      setError("Passwords must match.");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const result = await postJson("/api/portal/recover/confirm", {
        recoveryToken,
        otp,
        newPassword,
      });

      if (result.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      if (result.status === 503) {
        setError(readError(result.data, "Email delivery is temporarily unavailable."));
        return;
      }
      if (result.status === 400) {
        setError(readError(result.data, "Password does not meet the security requirements."));
        return;
      }
      if (!result.ok) {
        setError(readError(result.data, "Invalid verification code."));
        return;
      }

      setStep(3);
      toast({
        title: "Password reset",
        description: "Your password has been updated. You can now sign in.",
      });
    } catch {
      setError("Recovery could not be completed. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <RecoveryStepper current={step} />

      {assistedMessage && step === 0 ? (
        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900">Assisted recovery required</h2>
          <p className="mt-2 text-sm text-gray-500">{assistedMessage}</p>
          <Button type="button" className={`mt-6 ${primaryBtn}`} onClick={() => setLocation("/login?as=patient")}>
            Back to Log In
          </Button>
        </div>
      ) : null}

      {step === 0 && !assistedMessage && (
        <form onSubmit={onVerify} className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold text-gray-900">Verify your hospital record</h2>
          <p className="mt-2 text-sm text-gray-500">
            Enter your Hospital Patient ID, last name, and date of birth as registered with ACE Medical Center Cebu.
          </p>
          <div className="mt-5 space-y-5">
            <div className="space-y-1.5">
              <RequiredLabel htmlFor="patientHisId">Hospital Patient ID</RequiredLabel>
              <Input
                id="patientHisId"
                placeholder="Enter your hospital patient ID"
                className={fieldClass}
                value={form.patientHisId}
                onChange={(e) => update("patientHisId", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <RequiredLabel htmlFor="lastName">Last Name</RequiredLabel>
              <Input
                id="lastName"
                placeholder="Enter your last name"
                className={fieldClass}
                value={form.lastName}
                onChange={(e) => update("lastName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <RequiredLabel htmlFor="dateOfBirth">Date of Birth</RequiredLabel>
              <Input
                id="dateOfBirth"
                type="date"
                className={fieldClass}
                value={form.dateOfBirth}
                onChange={(e) => update("dateOfBirth", e.target.value)}
              />
            </div>
          </div>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          <Button type="submit" className={`mt-6 ${primaryBtn}`} disabled={busy}>
            {busy ? "Verifying…" : "Continue"}
          </Button>
        </form>
      )}

      {step === 1 && (
        <form onSubmit={onConfirmOtp} className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold text-gray-900">Verify your email</h2>
          <p className="mt-2 text-sm text-gray-500">
            Enter the 6-digit code sent to {maskedEmail ?? "your registered portal email"}.
          </p>
          <div className="mt-6 flex justify-center">
            <InputOTP maxLength={6} value={otp} onChange={setOtp}>
              <InputOTPGroup className="gap-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="h-12 w-12 rounded-md border border-gray-200 text-lg first:rounded-md last:rounded-md"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          <div className="mt-6 flex gap-2">
            <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => setStep(0)} disabled={busy}>
              Back
            </Button>
            <Button type="submit" className={`flex-1 ${primaryBtn}`} disabled={busy || otp.length !== 6}>
              {busy ? "Verifying…" : "Continue"}
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={onResetPassword} className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold text-gray-900">Set a new password</h2>
          <p className="mt-2 text-sm text-gray-500">
            Choose a new password for signing in to the Patient Portal. Your access code for viewing results is unchanged.
          </p>
          <div className="mt-5 space-y-5">
            <div className="space-y-1.5">
              <RequiredLabel htmlFor="newPassword">New Password</RequiredLabel>
              <PasswordInput
                id="newPassword"
                placeholder="Enter a new password"
                className={fieldClass}
                autoComplete="new-password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((current) => ({ ...current, newPassword: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <RequiredLabel htmlFor="confirmPassword">Confirm Password</RequiredLabel>
              <PasswordInput
                id="confirmPassword"
                placeholder="Re-enter your new password"
                className={fieldClass}
                autoComplete="new-password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((current) => ({ ...current, confirmPassword: e.target.value }))}
              />
            </div>
          </div>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          <div className="mt-6 flex gap-2">
            <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => setStep(1)} disabled={busy}>
              Back
            </Button>
            <Button type="submit" className={`flex-1 ${primaryBtn}`} disabled={busy}>
              {busy ? "Saving…" : "Reset Password"}
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#2f5d38] text-white">
            <Check className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-2xl font-bold text-gray-900">Recovery complete</h2>
          <p className="mt-2 text-sm text-gray-500">
            Your password has been reset. Sign in with your Hospital Patient ID, last name, and new password.
          </p>
          <Button type="button" className={`mt-6 ${primaryBtn}`} onClick={() => setLocation("/login?as=patient")}>
            Back to Log In
          </Button>
        </div>
      )}
    </div>
  );
}

function ResetCard({
  children,
  onClose,
  description,
}: {
  children: ReactNode;
  onClose: () => void;
  description: string;
}) {
  return (
    <div className="relative mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 text-[#2f5d38] hover:text-[#254a2d]"
        aria-label="Close recovery form"
      >
        <X className="h-5 w-5" strokeWidth={2.5} />
      </button>
      <h2 className="pr-8 text-2xl font-bold tracking-tight text-gray-900">Reset Your Password</h2>
      <p className="mt-2 text-sm text-gray-500">{description}</p>
      {children}
    </div>
  );
}

function DoctorRecovery({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !doctorName.trim()) {
      setError("Please complete all required fields.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/account-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "doctor", email: email.trim(), doctorName: doctorName.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Unable to submit recovery request.");
        return;
      }
      toast({
        title: "Reset requested",
        description:
          typeof body.message === "string"
            ? body.message
            : "If these details match a physician account, support will process the request.",
      });
    } catch {
      setError("Unable to submit recovery request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResetCard
      onClose={onClose}
      description="Enter your registered email and doctor name to receive a password reset link."
    >
      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <div className="space-y-1.5">
          <RequiredLabel htmlFor="doctorEmail">Email Address</RequiredLabel>
          <Input
            id="doctorEmail"
            type="email"
            placeholder="Enter your email address"
            className={fieldClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <RequiredLabel htmlFor="doctorName">Doctor Name</RequiredLabel>
          <Input
            id="doctorName"
            placeholder="Enter your doctor name"
            className={fieldClass}
            value={doctorName}
            onChange={(e) => setDoctorName(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className={sageBtn} disabled={busy}>
          {busy ? "Submitting…" : "Send Reset Link"}
        </Button>
      </form>
    </ResetCard>
  );
}

function roleFromQuery(): "doctor" | "patient" | "" {
  try {
    const value = new URLSearchParams(window.location.search).get("as");
    if (value === "doctor" || value === "patient") return value;
  } catch {
    // keep default
  }
  return "";
}

export default function RecoverPage() {
  const [role, setRole] = useState<"doctor" | "patient" | "">("");

  useEffect(() => {
    const fromQuery = roleFromQuery();
    if (fromQuery) setRole(fromQuery);
  }, []);

  return (
    <div className="min-h-screen bg-[#f3f4f6] px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <Link href="/login" className="inline-flex text-sm font-semibold tracking-wide text-[#2f5d38] hover:underline">
          ← BACK
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight text-gray-900 sm:text-[34px]">Account Recovery</h1>

        <div className="mt-6 space-y-1.5">
          <Label className="text-[15px] font-semibold text-gray-900">Select a role</Label>
          <Select value={role || undefined} onValueChange={(value) => setRole(value as "doctor" | "patient")}>
            <SelectTrigger className={`${fieldClass} max-w-md bg-white px-3`}>
              <SelectValue placeholder="Doctor or Patient" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="doctor">Doctor</SelectItem>
              <SelectItem value="patient">Patient</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500">
            Staff password resets are handled by your system administrator. Staff login remains available on the login
            page.
          </p>
        </div>

        {role === "patient" && <PatientRecovery />}
        {role === "doctor" && <DoctorRecovery onClose={() => setRole("")} />}
      </div>
    </div>
  );
}
