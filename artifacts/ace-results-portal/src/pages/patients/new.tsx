import { useState } from "react";
import { useLocation } from "wouter";
import { useCreatePatient } from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, ArrowLeft } from "lucide-react";

export default function NewPatientPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState({
    patientHisId: "",
    lastName: "",
    firstName: "",
    middleName: "",
    dateOfBirth: "",
    mobileNumber: "",
    email: "",
  });
  const [created, setCreated] = useState<{ accessCode: string; id: number; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const createPatient = useCreatePatient();

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patientHisId || !form.lastName || !form.firstName || !form.dateOfBirth) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createPatient.mutate(
      {
        data: {
          patientHisId: form.patientHisId,
          lastName: form.lastName,
          firstName: form.firstName,
          middleName: form.middleName || undefined,
          dateOfBirth: form.dateOfBirth,
          mobileNumber: form.mobileNumber || undefined,
          email: form.email || undefined,
        },
      },
      {
        onSuccess: (data) => {
          setCreated({ accessCode: data.accessCode, id: data.id, name: `${data.firstName} ${data.lastName}` });
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Failed to create patient", variant: "destructive" });
        },
      }
    );
  };

  const copyCode = () => {
    navigator.clipboard.writeText(created!.accessCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (created) {
    return (
      <StaffLayout>
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-primary">Patient Registered</h2>
            <p className="text-muted-foreground">{created.name} has been added to the system.</p>
          </div>

          <div className="bg-card border-2 border-secondary/30 rounded-xl p-6 text-center space-y-3">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Secure Access Code</p>
            <p className="text-3xl font-mono font-bold text-primary tracking-widest">{created.accessCode}</p>
            <p className="text-xs text-muted-foreground">Provide this code to the patient to access their results</p>
            <Button variant="outline" size="sm" onClick={copyCode} className="gap-2">
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied!" : "Copy Code"}
            </Button>
          </div>

          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => setLocation(`/patients/${created.id}`)}>View Patient</Button>
            <Button variant="outline" className="flex-1" onClick={() => {
              setCreated(null);
              setForm({ patientHisId: "", lastName: "", firstName: "", middleName: "", dateOfBirth: "", mobileNumber: "", email: "" });
            }}>Add Another</Button>
          </div>
        </div>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/patients")}>
            <ArrowLeft className="w-4 h-4 mr-1" />Back
          </Button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-primary">New Patient</h2>
            <p className="text-muted-foreground">Register a new patient and generate their access code</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="hisId">Patient HIS ID <span className="text-destructive">*</span></Label>
              <Input id="hisId" placeholder="e.g. ACE-2024-00001" {...field("patientHisId")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last Name <span className="text-destructive">*</span></Label>
              <Input id="lastName" placeholder="Dela Cruz" {...field("lastName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First Name <span className="text-destructive">*</span></Label>
              <Input id="firstName" placeholder="Juan" {...field("firstName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="middleName">Middle Name</Label>
              <Input id="middleName" placeholder="Santos" {...field("middleName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of Birth <span className="text-destructive">*</span></Label>
              <Input id="dob" type="date" {...field("dateOfBirth")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile">Mobile Number</Label>
              <Input id="mobile" placeholder="09XX XXX XXXX" {...field("mobileNumber")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email Address</Label>
              <Input id="email" type="email" placeholder="patient@email.com" {...field("email")} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={createPatient.isPending} className="flex-1">
              {createPatient.isPending ? "Registering..." : "Register Patient"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setLocation("/patients")}>Cancel</Button>
          </div>
        </form>
      </div>
    </StaffLayout>
  );
}
