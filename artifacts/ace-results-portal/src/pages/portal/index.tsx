import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useVerifyPatientAccess } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import aceLogo from "@assets/ace_logo_new_1781354030491.jpg";

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
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* ── Green branding strip ───────────────────────────────── */}
      <div className="bg-[#1a5c2a] flex flex-col items-center pt-10 pb-8 px-6 text-center text-white">
        <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-lg ring-4 ring-white/20 mb-3">
          <img src={aceLogo} alt="ACE Medical Center" className="w-[72px] h-[72px] object-contain rounded-full" />
        </div>
        <h1 className="text-lg font-extrabold tracking-wide uppercase">Allied Care Experts</h1>
        <p className="text-xs font-semibold tracking-widest text-green-200 uppercase mt-0.5">Medical Center · Cebu</p>
      </div>

      {/* ── Form ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center px-5 py-8">
        <div className="w-full max-w-sm mx-auto space-y-6">

          <div className="text-center space-y-0.5">
            <h2 className="text-lg font-bold text-gray-800">Patient Results Portal</h2>
            <p className="text-sm text-gray-500">Access your diagnostic results securely</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="hisId" className="text-gray-700">Patient ID</Label>
              <Input id="hisId" placeholder="e.g. ACE-2024-00001" className="h-11" {...field("patientHisId")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName" className="text-gray-700">Last Name</Label>
              <Input id="lastName" placeholder="As registered with ACE Medical" className="h-11" {...field("lastName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code" className="text-gray-700">Secure Access Code</Label>
              <Input id="code" placeholder="ACE-XXXX-XXXX" className="h-11" {...field("accessCode")} />
              <p className="text-xs text-gray-400">Provided by ACE Medical Center staff upon registration</p>
            </div>

            {/* Consent */}
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(e) => setConsented(e.target.checked)}
                  className="mt-0.5 accent-[#1a5c2a] w-4 h-4 flex-shrink-0"
                />
                <span className="text-xs text-gray-500 leading-relaxed">
                  I confirm that I am the patient named above or an authorized representative, and I am accessing these medical results for legitimate purposes. Unauthorized access is strictly prohibited.
                </span>
              </label>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-[#1a5c2a] hover:bg-[#155224] text-white font-semibold rounded-xl"
              disabled={verify.isPending || !consented}
            >
              {verify.isPending ? "Verifying…" : "Access My Results"}
            </Button>
          </form>

          <div className="text-center border-t border-gray-200 pt-5 space-y-2">
            <p className="text-sm text-gray-500">
              Hospital staff?{" "}
              <Link href="/login" className="text-[#1a5c2a] font-semibold hover:underline">
                Staff Login
              </Link>
            </p>
            <Link href="/" className="text-xs text-gray-400 hover:text-gray-600">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
