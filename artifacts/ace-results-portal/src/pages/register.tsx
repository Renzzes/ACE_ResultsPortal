import { useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { copyText } from "@/lib/copy-text";

const fieldClass =
  "h-12 w-full rounded-md border-gray-200 bg-white text-[15px] placeholder:text-gray-400 focus-visible:ring-[#97ab96]";

const verifySchema = z.object({
  patientHisId: z.string().trim().min(1, "Hospital Patient ID is required").max(64),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date of birth"),
});

const emailSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address").max(255),
    confirmEmail: z.string().trim().email("Enter a valid email address").max(255),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/\d/, "Include at least one number")
      .regex(/[A-Z]/, "Include at least one uppercase letter")
      .regex(/[a-z]/, "Include at least one lowercase letter")
      .regex(/[^A-Za-z0-9]/, "Include at least one special character"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((values) => values.email.toLowerCase() === values.confirmEmail.toLowerCase(), {
    message: "Email addresses must match",
    path: ["confirmEmail"],
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"],
  });

type VerifyValues = z.infer<typeof verifySchema>;
type EmailValues = z.infer<typeof emailSchema>;

type Step = "verify" | "email" | "existing" | "created";

function readError(data: Record<string, unknown>, fallback: string): string {
  if (typeof data.error === "string") return data.error;
  if (typeof data.message === "string") return data.message;
  return fallback;
}

export function RegisterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("verify");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const verifyForm = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    mode: "onChange",
    defaultValues: { patientHisId: "", lastName: "", dateOfBirth: "" },
  });

  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    mode: "onChange",
    defaultValues: { email: "", confirmEmail: "", password: "", confirmPassword: "" },
  });

  function resetAll() {
    verifyForm.reset({ patientHisId: "", lastName: "", dateOfBirth: "" });
    emailForm.reset({ email: "", confirmEmail: "", password: "", confirmPassword: "" });
    setStep("verify");
    setBusy(false);
    setError(null);
    setRegistrationToken(null);
    setAccessCode(null);
    setCopied(false);
    setCopyError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next && busy) return;
    if (!next) resetAll();
    onOpenChange(next);
  }

  async function onVerifySubmit(values: VerifyValues) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/portal/verify-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientHisId: values.patientHisId.trim(),
          lastName: values.lastName.trim(),
          dateOfBirth: values.dateOfBirth.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      if (response.status === 503) {
        setError(readError(data, "Patient verification is temporarily unavailable. Please try again later."));
        return;
      }
      if (!response.ok || data.verified !== true) {
        setError(readError(data, "Patient information could not be verified."));
        return;
      }

      if (data.isNewPortalAccount === true && typeof data.registrationToken === "string") {
        setRegistrationToken(data.registrationToken);
        setStep("email");
        toast({ title: "Patient Record Verified" });
        return;
      }

      if (data.needsPortalActivation === true && typeof data.registrationToken === "string") {
        setRegistrationToken(data.registrationToken);
        setStep("email");
        toast({
          title: "Activate your portal account",
          description: "Create a login password for your existing hospital record.",
        });
        return;
      }

      setStep("existing");
      toast({ title: "Patient Record Verified" });
    } catch {
      setError("Patient verification is temporarily unavailable. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function onEmailSubmit(values: EmailValues) {
    if (!registrationToken) {
      setError("Registration verification has expired. Please verify your hospital record again.");
      setStep("verify");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/portal/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationToken,
          email: values.email.trim().toLowerCase(),
          confirmEmail: values.confirmEmail.trim().toLowerCase(),
          password: values.password,
          confirmPassword: values.confirmPassword,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      if (response.status === 409) {
        setError(readError(data, "Unable to create account."));
        if (typeof data.error === "string" && data.error.includes("already registered")) {
          setStep("existing");
        }
        return;
      }
      if (response.status === 401) {
        setError(readError(data, "Registration verification has expired. Please verify your hospital record again."));
        setStep("verify");
        setRegistrationToken(null);
        return;
      }
      if (!response.ok || data.created !== true) {
        setError(readError(data, "Unable to create your portal account. Please try again later."));
        return;
      }

      if (typeof data.accessCode === "string") {
        setAccessCode(data.accessCode);
      }
      setStep("created");
      toast({ title: "Account Created" });
    } catch {
      setError("Unable to create your portal account. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode(code: string) {
    setCopyError(null);
    const ok = await copyText(code);
    if (!ok) {
      setCopyError("Unable to copy automatically. Please copy the access code manually.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="ace-scroll max-h-[90vh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto sm:rounded-2xl">
        {step === "verify" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold tracking-tight text-gray-900 sm:text-[28px]">
                Verify Your Hospital Record
              </DialogTitle>
              <DialogDescription>
                Enter the information registered with ACE Medical Center Cebu. Your information will be
                securely verified against the hospital patient record.
              </DialogDescription>
            </DialogHeader>
            <Form {...verifyForm}>
              <form onSubmit={verifyForm.handleSubmit(onVerifySubmit)} className="space-y-4">
                <FormField
                  control={verifyForm.control}
                  name="patientHisId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[15px] font-semibold text-gray-900">
                        Hospital Patient ID<span className="ml-0.5 text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your hospital patient ID" className={fieldClass} autoComplete="off" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={verifyForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[15px] font-semibold text-gray-900">
                        Last Name<span className="ml-0.5 text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your last name" className={fieldClass} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={verifyForm.control}
                  name="dateOfBirth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[15px] font-semibold text-gray-900">
                        Date of Birth<span className="ml-0.5 text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="date" className={fieldClass} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
                )}
                <Button type="submit" className="h-12 w-full" disabled={!verifyForm.formState.isValid || busy}>
                  {busy ? "Verifying…" : "Verify Patient Record"}
                </Button>
              </form>
            </Form>
          </>
        )}

        {step === "email" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold tracking-tight text-gray-900 sm:text-[28px]">
                Create Your Patient Portal Account
              </DialogTitle>
              <DialogDescription>
                Your hospital record has been verified. Enter an email address for account recovery and create a password to sign in.
              </DialogDescription>
            </DialogHeader>
            <Form {...emailForm}>
              <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
                <FormField
                  control={emailForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[15px] font-semibold text-gray-900">
                        Email Address<span className="ml-0.5 text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Enter your email address" className={fieldClass} autoComplete="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={emailForm.control}
                  name="confirmEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[15px] font-semibold text-gray-900">
                        Confirm Email Address<span className="ml-0.5 text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Re-enter your email address" className={fieldClass} autoComplete="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={emailForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[15px] font-semibold text-gray-900">
                        Password<span className="ml-0.5 text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <PasswordInput placeholder="Create a password" className={fieldClass} autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={emailForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[15px] font-semibold text-gray-900">
                        Confirm Password<span className="ml-0.5 text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <PasswordInput placeholder="Re-enter your password" className={fieldClass} autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => setStep("verify")} disabled={busy}>
                    Back
                  </Button>
                  <Button type="submit" className="h-12 flex-1" disabled={!emailForm.formState.isValid || busy}>
                    {busy ? "Creating…" : "Create Account"}
                  </Button>
                </div>
              </form>
            </Form>
          </>
        )}

        {step === "existing" && (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold tracking-tight text-gray-900 sm:text-[28px]">
                Patient Record Verified
              </DialogTitle>
            </DialogHeader>
            <div className="rounded-xl border border-[#DDE5E0] bg-[#F6F9F7] px-4 py-3">
              <p className="text-[15px] font-semibold text-[#153D2B]">Your hospital record is already registered.</p>
              <p className="mt-1 text-sm text-[#64706A]">
                Sign in with your Hospital Patient ID and the password you created during registration.
              </p>
            </div>
            <Button type="button" className="h-12 w-full" onClick={() => handleOpenChange(false)}>
              Sign In
            </Button>
          </div>
        )}

        {step === "created" && (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold tracking-tight text-gray-900 sm:text-[28px]">
                {accessCode ? "Account Created" : "Portal Account Activated"}
              </DialogTitle>
            </DialogHeader>
            <div className="rounded-xl border border-[#DDE5E0] bg-[#F6F9F7] px-4 py-3">
              <p className="text-[15px] font-semibold text-[#153D2B]">
                {accessCode ? "Your hospital record has been verified." : "Your portal login has been set up."}
              </p>
              <p className="mt-1 text-sm text-[#64706A]">
                {accessCode
                  ? "Your Patient Portal account has been created."
                  : "Sign in with your Hospital Patient ID, last name, and the password you just created."}
              </p>
            </div>
            {accessCode && (
              <div className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-4 text-center">
                <p className="text-sm font-medium uppercase tracking-wide text-amber-900">Access Code</p>
                <p className="font-mono text-2xl font-bold tracking-widest text-[#153D2B]">{accessCode}</p>
                <p className="text-sm font-semibold text-amber-900">
                  Save this code securely. You will need it to view and download your diagnostic results.
                </p>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void copyCode(accessCode)}>
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy Access Code"}
                </Button>
                {copyError ? <p className="text-sm text-red-700">{copyError}</p> : null}
              </div>
            )}
            <Button type="button" className="h-12 w-full" onClick={() => handleOpenChange(false)}>
              Continue to Login
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function RegisterPage() {
  const [open, setOpen] = useState(true);
  return <RegisterDialog open={open} onOpenChange={setOpen} />;
}
