import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useCreatePatient, useListPatients, getListPatientsQueryKey } from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, ArrowLeft, AlertTriangle, Upload, User } from "lucide-react";

interface ExistingPatient {
  id: number;
  patientHisId: string;
  lastName: string;
  firstName: string;
}

function DuplicateAlert({ patient, onDismiss }: { patient: ExistingPatient; onDismiss: () => void }) {
  const [, setLocation] = useLocation();
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-900">Patient already registered</p>
          <p className="text-sm text-amber-800 mt-0.5">
            A record for <span className="font-mono font-semibold">{patient.patientHisId}</span> already exists in the system.
          </p>
        </div>
      </div>

      <div className="bg-white border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-amber-700" />
        </div>
        <div>
          <p className="font-semibold text-sm">{patient.lastName}, {patient.firstName}</p>
          <p className="text-xs text-muted-foreground font-mono">{patient.patientHisId}</p>
        </div>
      </div>

      <p className="text-sm text-amber-800">
        You can upload results to their existing account or view their record:
      </p>

      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setLocation(`/results/upload?patientId=${patient.patientHisId}`)}
        >
          <Upload className="w-4 h-4" />
          Upload Result for this Patient
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setLocation(`/patients/${patient.id}`)}
        >
          <User className="w-4 h-4" />
          View Patient Record
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
        >
          Enter a different ID
        </Button>
      </div>
    </div>
  );
}

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
  const [existingPatient, setExistingPatient] = useState<ExistingPatient | null>(null);
  const [hisIdChecked, setHisIdChecked] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createPatient = useCreatePatient();

  // Live HIS ID duplicate check — debounced 500ms after typing stops
  const { data: hisIdCheckResult } = useListPatients(
    { search: hisIdChecked, limit: 1 },
    {
      query: {
        queryKey: [...getListPatientsQueryKey({ search: hisIdChecked, limit: 1 }), "hischeck"],
        enabled: hisIdChecked.length >= 3,
      }
    }
  );

  useEffect(() => {
    if (!hisIdChecked || hisIdChecked.length < 3) { setExistingPatient(null); return; }
    const match = hisIdCheckResult?.data?.find(
      (p) => p.patientHisId.toLowerCase() === hisIdChecked.toLowerCase()
    );
    if (match) {
      setExistingPatient({ id: match.id, patientHisId: match.patientHisId, lastName: match.lastName, firstName: match.firstName });
    } else {
      setExistingPatient(null);
    }
  }, [hisIdCheckResult, hisIdChecked]);

  const handleHisIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm(f => ({ ...f, patientHisId: value }));
    setExistingPatient(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setHisIdChecked(value.trim()), 500);
  };

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (existingPatient) return;
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
          const body = err?.response?.data;
          if (body?.existingPatient) {
            setExistingPatient(body.existingPatient);
          } else {
            toast({ title: body?.error ?? "Failed to create patient", variant: "destructive" });
          }
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
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setLocation(`/results/upload?patientId=${created.id}`)}
            >
              <Upload className="w-4 h-4 mr-1.5" />Upload Result
            </Button>
            <Button variant="ghost" onClick={() => {
              setCreated(null);
              setForm({ patientHisId: "", lastName: "", firstName: "", middleName: "", dateOfBirth: "", mobileNumber: "", email: "" });
              setExistingPatient(null);
              setHisIdChecked("");
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

        {/* Duplicate alert — shown inline above the form */}
        {existingPatient && (
          <DuplicateAlert
            patient={existingPatient}
            onDismiss={() => {
              setExistingPatient(null);
              setHisIdChecked("");
              setForm(f => ({ ...f, patientHisId: "" }));
            }}
          />
        )}

        <form onSubmit={handleSubmit} className={`bg-card border border-border rounded-xl p-6 space-y-5 shadow-sm ${existingPatient ? "opacity-50 pointer-events-none" : ""}`}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="hisId">Patient HIS ID <span className="text-destructive">*</span></Label>
              <Input
                id="hisId"
                placeholder="e.g. ACE-2024-00001"
                value={form.patientHisId}
                onChange={handleHisIdChange}
                autoComplete="off"
              />
              {hisIdChecked.length >= 3 && !existingPatient && !hisIdCheckResult && (
                <p className="text-xs text-muted-foreground">Checking...</p>
              )}
              {hisIdChecked.length >= 3 && !existingPatient && hisIdCheckResult && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <Check className="w-3 h-3" /> ID available
                </p>
              )}
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
            <Button type="submit" disabled={createPatient.isPending || !!existingPatient} className="flex-1">
              {createPatient.isPending ? "Registering..." : "Register Patient"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setLocation("/patients")}>Cancel</Button>
          </div>
        </form>
      </div>
    </StaffLayout>
  );
}
