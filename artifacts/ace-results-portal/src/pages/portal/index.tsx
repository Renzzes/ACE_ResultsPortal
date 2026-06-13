import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useVerifyPatientAccess } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ShieldCheck } from "lucide-react";

export default function PatientPortalPage() {
  const [, setLocation] = useLocation();
  const { setPortalAuth } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ patientHisId: "", lastName: "", accessCode: "" });
  const [consented, setConsented] = useState(false);

  const verify = useVerifyPatientAccess();

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consented) {
      toast({ title: "Please accept the consent statement to proceed", variant: "destructive" });
      return;
    }
    if (!form.patientHisId || !form.lastName || !form.accessCode) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }

    verify.mutate(
      { data: { patientHisId: form.patientHisId, lastName: form.lastName, accessCode: form.accessCode } },
      {
        onSuccess: (data) => {
          setPortalAuth(data.patient, data.sessionToken);
          setLocation("/portal/results");
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Invalid credentials. Please check your details.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-primary">Patient Results Portal</h1>
          <p className="text-muted-foreground text-sm">
            Access your diagnostic results securely using your Patient ID and access code.
          </p>
        </div>

        {/* Form Card */}
        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl shadow-sm p-7 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="hisId">Patient ID</Label>
            <Input id="hisId" placeholder="e.g. ACE-2024-00001" {...field("patientHisId")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last Name</Label>
            <Input id="lastName" placeholder="As registered with ACE Medical" {...field("lastName")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">Secure Access Code</Label>
            <Input id="code" placeholder="ACE-XXXX-XXXX" {...field("accessCode")} />
            <p className="text-xs text-muted-foreground">Provided by ACE Medical Center staff upon registration</p>
          </div>

          {/* Consent */}
          <div className="bg-muted/50 rounded-lg p-3 border border-border">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                I confirm that I am the patient named above or an authorized representative, and I am accessing these medical results for legitimate purposes. Unauthorized access is strictly prohibited.
              </span>
            </label>
          </div>

          <Button type="submit" className="w-full" disabled={verify.isPending || !consented}>
            {verify.isPending ? "Verifying..." : "Access My Results"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Hospital staff?{" "}
          <Link href="/login" className="text-secondary font-medium hover:underline">
            Staff Login
          </Link>
        </p>
      </div>
    </div>
  );
}
