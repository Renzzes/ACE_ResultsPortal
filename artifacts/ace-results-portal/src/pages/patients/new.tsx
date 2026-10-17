import { useState, useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useCreatePatient, customFetch } from "@workspace/api-client-react";
import { StaffLayout } from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { canUploadResultFileUi } from "@/lib/staff-permissions";
import { registrationUploadPath } from "@/lib/workflow-stability";
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  Upload,
  Stethoscope,
  X,
  Search,
  Info,
  UserPlus,
  ChevronDown,
} from "lucide-react";

function SectionCard({
  step,
  title,
  optional,
  description,
  children,
}: {
  step: number;
  title: string;
  optional?: boolean;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="st-card relative z-0 flex min-h-0 flex-col rounded-xl px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[hsl(var(--st-green))] text-xs font-bold text-white">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-tight text-[hsl(var(--st-text))]">
            {title}
            {optional ? (
              <span className="ml-1.5 text-xs font-medium text-[hsl(var(--st-muted))]">(Optional)</span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs leading-snug st-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs font-semibold text-[hsl(var(--st-text))]">
      {children}
      {required ? <span className="text-[hsl(var(--st-maroon))]"> *</span> : null}
    </Label>
  );
}

const fieldInputClass =
  "h-9 rounded-lg border-[hsl(var(--st-border))] bg-white text-sm shadow-sm focus-visible:border-[hsl(var(--st-green))] focus-visible:ring-[hsl(var(--st-green))]/20";

interface Physician { id: number; name: string; username: string }

interface HospitalLookupResult {
  hospitalRecordFound: boolean;
  portalPatientFound: boolean;
  portalAccountFound: boolean;
  departmentMembershipExists: boolean | null;
  action: string;
  message: string;
  patientHisId?: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  dateOfBirth?: string;
  patientId?: number;
  reuseToken?: string;
}

const REUSE_ACTIONS = new Set(["USE_EXISTING_PATIENT", "USE_EXISTING_ACCOUNT", "ACCOUNT_NEEDS_RESOLUTION"]);

export default function NewPatientPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { auth } = useAuth();
  const canAssign = ["super_admin", "medical_records"].includes(auth.user?.role ?? "");
  const canUpload = canUploadResultFileUi(auth.user?.role, auth.user?.permissions);

  const [form, setForm] = useState({
    patientHisId: "", lastName: "", firstName: "", middleName: "",
    dateOfBirth: "", mobileNumber: "", email: "",
  });
  const [created, setCreated] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [lookup, setLookup] = useState<HospitalLookupResult | null>(null);
  const [lookupUnavailable, setLookupUnavailable] = useState(false);
  const [reusePending, setReusePending] = useState(false);

  // Physician selector state
  const [physicianSearch, setPhysicianSearch] = useState("");
  const [physicianResults, setPhysicianResults] = useState<Physician[]>([]);
  const [selectedPhysician, setSelectedPhysician] = useState<Physician | null>(null);
  const [showPhysicianDrop, setShowPhysicianDrop] = useState(false);
  const physicianDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hisLookupPending, setHisLookupPending] = useState(false);
  const [hisVerified, setHisVerified] = useState(false);

  const createPatient = useCreatePatient();
  const reuseLocked = lookup ? REUSE_ACTIONS.has(lookup.action) : false;

  const handleHisIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm(f => ({ ...f, patientHisId: value }));
    setLookup(null);
    setLookupUnavailable(false);
    setHisVerified(false);
  };
  useEffect(() => {
    if (!physicianSearch.trim()) { setPhysicianResults([]); return; }
    if (physicianDebounceRef.current) clearTimeout(physicianDebounceRef.current);
    physicianDebounceRef.current = setTimeout(async () => {
      try {
        const data = await customFetch<Physician[]>(
          `/api/physicians?search=${encodeURIComponent(physicianSearch)}`,
        );
        setPhysicianResults(data);
      } catch {}
    }, 400);
  }, [physicianSearch]);

  const lookupHospitalPatient = async () => {
    const patientHisId = form.patientHisId.trim();
    if (!patientHisId) {
      toast({ title: "Enter a Hospital Patient ID first", variant: "destructive" });
      return;
    }
    setHisLookupPending(true);
    setLookup(null);
    setLookupUnavailable(false);
    setHisVerified(false);
    try {
      const data = await customFetch<HospitalLookupResult>(
        `/api/patients/hospital-lookup?patientHisId=${encodeURIComponent(patientHisId)}`,
      );
      setLookup(data);
      if (data.action === "CONTINUE_REGISTRATION" && data.patientHisId && data.firstName && data.lastName && data.dateOfBirth) {
        setForm((f) => ({
          ...f,
          patientHisId: data.patientHisId ?? f.patientHisId,
          firstName: data.firstName ?? "",
          middleName: data.middleName ?? "",
          lastName: data.lastName ?? "",
          dateOfBirth: data.dateOfBirth ?? "",
        }));
        setHisVerified(true);
      } else if (data.hospitalRecordFound && data.patientHisId) {
        setForm((f) => ({
          ...f,
          patientHisId: data.patientHisId ?? f.patientHisId,
          firstName: data.firstName ?? f.firstName,
          middleName: data.middleName ?? f.middleName,
          lastName: data.lastName ?? f.lastName,
          dateOfBirth: data.dateOfBirth ?? f.dateOfBirth,
        }));
      }
    } catch (err: any) {
      setHisVerified(false);
      if (err?.status === 503) {
        setLookupUnavailable(true);
        return;
      }
      toast({
        title: err?.data?.error ?? err?.message ?? "Hospital patient lookup failed",
        variant: "destructive",
      });
    } finally {
      setHisLookupPending(false);
    }
  };

  const useExistingAccount = async () => {
    if (!lookup?.reuseToken || !lookup.patientHisId || !lookup.lastName || !lookup.firstName || !lookup.dateOfBirth) {
      toast({ title: "Look up the hospital record again before continuing", variant: "destructive" });
      return;
    }
    setReusePending(true);
    try {
      const data = await customFetch<{ id: number; firstName: string; lastName: string; accessCode?: string | null }>(
        "/api/patients",
        {
          method: "POST",
          body: JSON.stringify({
            patientHisId: lookup.patientHisId,
            lastName: lookup.lastName,
            firstName: lookup.firstName,
            middleName: lookup.middleName || undefined,
            dateOfBirth: lookup.dateOfBirth,
            reuseToken: lookup.reuseToken,
          }),
        },
      );
      if (data.accessCode) {
        toast({ title: "A new access code was not expected for an existing account", variant: "destructive" });
        return;
      }
      toast({ title: "Existing patient is ready for your department." });
      setLocation(`/patients/${data.id}`);
    } catch (err: any) {
      toast({
        title: err?.data?.error ?? "Could not use the existing patient",
        variant: "destructive",
      });
    } finally {
      setReusePending(false);
    }
  };

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reuseLocked) return;
    if (!form.patientHisId || !form.lastName || !form.firstName || !form.dateOfBirth) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    if (!hisVerified) {
      toast({
        title: "Verify the hospital record first",
        description: "Use “Look Up Hospital Record / Account” so identity comes from the hospital record.",
        variant: "destructive",
      });
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
          ...(canAssign ? { physicianId: selectedPhysician?.id ?? undefined } : {}),
        },
      },
      {
        onSuccess: (data) => {
          setCreated({
            id: data.id,
            name: `${data.firstName} ${data.lastName}`,
          });
        },
        onError: (err: any) => {
          const body = err?.response?.data ?? err?.data;
          toast({ title: body?.error ?? "Failed to create patient", variant: "destructive" });
        },
      }
    );
  };


  function resetRegistrationForm() {
    setCreated(null);
    setForm({ patientHisId: "", lastName: "", firstName: "", middleName: "", dateOfBirth: "", mobileNumber: "", email: "" });
    setLookup(null);
    setLookupUnavailable(false);
    setHisVerified(false);
    setSelectedPhysician(null);
    setPhysicianSearch("");
  }

  const registerDisabled =
    createPatient.isPending ||
    reuseLocked ||
    lookupUnavailable ||
    lookup?.action === "NOT_FOUND" ||
    lookup?.action === "AMBIGUOUS" ||
    lookup?.action === "NOT_ELIGIBLE";

  const identityLocked = lookup?.hospitalRecordFound === true;

  return (
    <StaffLayout fill showSearch={false}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-2 pb-2">
          <div className="min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mb-0.5 h-8 px-2 text-[hsl(var(--st-text))] hover:bg-[hsl(var(--st-green-soft))]"
              onClick={() => setLocation("/patients")}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
            <h1 className="text-xl font-bold tracking-tight text-[hsl(var(--st-text))] sm:text-2xl">
              New Patient
            </h1>
            <p className="mt-0.5 text-xs st-muted sm:text-sm">
              Register a hospital patient record. Document access codes are issued when a result is uploaded.
            </p>
          </div>
        </div>

        {(lookupUnavailable || lookup) && (
          <div className="mb-2 flex-shrink-0 space-y-2">
            {lookupUnavailable && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Hospital Record Lookup: Unavailable</p>
                    <p className="text-xs text-amber-800">Unable to verify the hospital record right now. Please try again.</p>
                  </div>
                </div>
              </div>
            )}

            {lookup && (
              <div
                className={`rounded-xl border px-3 py-2 ${
                  reuseLocked ||
                  lookup.action === "NOT_FOUND" ||
                  lookup.action === "AMBIGUOUS" ||
                  lookup.action === "NOT_ELIGIBLE"
                    ? "border-amber-300 bg-amber-50"
                    : "border-[hsl(var(--st-green))]/30 bg-[hsl(var(--st-green-soft))]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    {lookup.hospitalRecordFound ? (
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--st-green))]" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                    )}
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-semibold text-[hsl(var(--st-text))]">
                        {lookup.hospitalRecordFound ? "Hospital Record: Verified" : "Hospital Record"}
                      </p>
                      <p className="text-xs text-[hsl(var(--st-text))]">{lookup.message}</p>
                      {lookup.action === "USE_EXISTING_ACCOUNT" && lookup.departmentMembershipExists === true && (
                        <p className="text-xs">This patient is already available to your department.</p>
                      )}
                      {lookup.action === "USE_EXISTING_ACCOUNT" && lookup.departmentMembershipExists === false && (
                        <p className="text-xs">This patient can be linked to your department without creating another account.</p>
                      )}
                    </div>
                  </div>
                  {lookup.reuseToken && (
                    <Button type="button" size="sm" disabled={reusePending} onClick={() => void useExistingAccount()}>
                      {reusePending ? "Saving…" : "Use Existing Account"}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
            <SectionCard
              step={1}
              title="Hospital Record"
              description="Search for an existing hospital record or enter the hospital patient ID (HIS ID)."
            >
              <div className="space-y-1.5">
                <FieldLabel htmlFor="hisId" required>
                  Patient HIS ID
                </FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="hisId"
                    placeholder="Enter hospital patient ID (e.g. 3214)"
                    value={form.patientHisId}
                    onChange={handleHisIdChange}
                    autoComplete="off"
                    required
                    aria-required="true"
                    className={`min-w-0 flex-1 ${fieldInputClass}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={hisLookupPending || !form.patientHisId.trim()}
                    onClick={() => void lookupHospitalPatient()}
                    className="h-9 shrink-0 rounded-lg border-[hsl(var(--st-border))] bg-white px-3 shadow-sm"
                  >
                    <Search className="mr-2 h-4 w-4" />
                    {hisLookupPending ? "Looking up…" : "Look Up Hospital Record"}
                  </Button>
                </div>
                <p className="flex items-center gap-1.5 text-[11px] st-muted">
                  <Info className="h-3 w-3 flex-shrink-0" aria-hidden />
                  This will check if the patient already exists in the hospital system.
                </p>
                {hisVerified && lookup?.action === "CONTINUE_REGISTRATION" && (
                  <p className="flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--st-green))]">
                    <Check className="h-3 w-3" />
                    Hospital record verified — no Patient Portal account found. Registration will not create a portal login.
                  </p>
                )}
              </div>
            </SectionCard>

            <SectionCard
              step={2}
              title="Personal Information"
              description="Enter the patient's basic information. Make sure the details match the hospital record."
            >
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1">
                  <FieldLabel htmlFor="lastName" required>
                    Last Name
                  </FieldLabel>
                  <Input
                    id="lastName"
                    placeholder="Enter last name"
                    {...field("lastName")}
                    readOnly={identityLocked}
                    required
                    aria-required="true"
                    className={fieldInputClass}
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel htmlFor="firstName" required>
                    First Name
                  </FieldLabel>
                  <Input
                    id="firstName"
                    placeholder="Enter first name"
                    {...field("firstName")}
                    readOnly={identityLocked}
                    required
                    aria-required="true"
                    className={fieldInputClass}
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel htmlFor="middleName">Middle Name</FieldLabel>
                  <Input
                    id="middleName"
                    placeholder="Enter middle name (optional)"
                    {...field("middleName")}
                    readOnly={identityLocked}
                    className={fieldInputClass}
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel htmlFor="dob" required>
                    Date of Birth
                  </FieldLabel>
                  <Input
                    id="dob"
                    type="date"
                    {...field("dateOfBirth")}
                    readOnly={identityLocked}
                    required
                    aria-required="true"
                    max={new Date().toISOString().slice(0, 10)}
                    className={fieldInputClass}
                  />
                </div>
                {/* Sex omitted: not on ACE_ResultsPortal.patients or CreatePatientBody. */}
                <div className="space-y-1">
                  <FieldLabel htmlFor="mobile">Mobile Number</FieldLabel>
                  <Input
                    id="mobile"
                    placeholder="09XX XXX XXXX"
                    {...field("mobileNumber")}
                    className={fieldInputClass}
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel htmlFor="email">Email Address</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter email address (optional)"
                    {...field("email")}
                    className={fieldInputClass}
                  />
                </div>
              </div>
            </SectionCard>

            {canAssign ? (
              <SectionCard
                step={3}
                title="Assign Attending Physician"
                optional
                description="Search and assign a physician who will handle this patient's diagnostic results."
              >
                {selectedPhysician ? (
                  <div className="flex items-center justify-between rounded-lg border border-[hsl(var(--st-green))]/25 bg-[hsl(var(--st-green-soft))] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white">
                        <Stethoscope className="h-3.5 w-3.5 text-[hsl(var(--st-green))]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[hsl(var(--st-text))]">{selectedPhysician.name}</p>
                        <p className="truncate text-xs st-muted">@{selectedPhysician.username}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg"
                      aria-label="Clear physician selection"
                      onClick={() => {
                        setSelectedPhysician(null);
                        setPhysicianSearch("");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Stethoscope className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--st-muted))]" />
                    <Input
                      placeholder="Search physician by name..."
                      value={physicianSearch}
                      onChange={(e) => {
                        setPhysicianSearch(e.target.value);
                        setShowPhysicianDrop(true);
                      }}
                      onFocus={() => setShowPhysicianDrop(true)}
                      onBlur={() => setTimeout(() => setShowPhysicianDrop(false), 150)}
                      aria-label="Search physician by name"
                      className={`${fieldInputClass} pl-9 pr-9`}
                    />
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--st-muted))]" />
                    {showPhysicianDrop && physicianResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-40 overflow-y-auto rounded-lg border border-[hsl(var(--st-border))] bg-white shadow-lg">
                        {physicianResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[hsl(var(--st-cream))]"
                            onMouseDown={() => {
                              setSelectedPhysician(p);
                              setPhysicianSearch("");
                              setShowPhysicianDrop(false);
                            }}
                          >
                            <Stethoscope className="h-3.5 w-3.5 flex-shrink-0 text-[hsl(var(--st-muted))]" />
                            <div>
                              <p className="text-sm font-medium text-[hsl(var(--st-text))]">{p.name}</p>
                              <p className="text-xs st-muted">@{p.username}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {physicianSearch.length > 0 && physicianResults.length === 0 && (
                      <p className="mt-1 text-[11px] st-muted">
                        No physicians found. You can assign one later from the patient record.
                      </p>
                    )}
                  </div>
                )}
              </SectionCard>
            ) : null}
          </div>

          <div className="sticky bottom-0 z-20 flex flex-shrink-0 flex-col-reverse gap-2 border-t border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))]/95 py-3 backdrop-blur-sm sm:static sm:flex-row sm:items-center sm:justify-end sm:bg-transparent sm:py-2 sm:backdrop-blur-none">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-lg border-[hsl(var(--st-border))] bg-white px-4 shadow-sm sm:h-9 sm:w-auto"
              onClick={() => setLocation("/patients")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={registerDisabled}
              className="h-11 w-full rounded-lg bg-[hsl(var(--st-maroon))] px-4 text-white hover:opacity-95 sm:h-9 sm:w-auto"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {createPatient.isPending ? "Registering…" : "Register Patient"}
            </Button>
          </div>
        </form>
      </div>

      <Dialog
        open={created != null}
        onOpenChange={(open) => {
          if (!open) resetRegistrationForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Patient Registered</DialogTitle>
            <DialogDescription>
              The patient has been registered successfully.
              {created ? ` ${created.name} is now available in the Staff Portal.` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full"
              onClick={() => {
                if (!created) return;
                const id = created.id;
                setCreated(null);
                setLocation(`/patients/${id}`);
              }}
            >
              View Patient
            </Button>
            {canUpload ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  if (!created) return;
                  const id = created.id;
                  setCreated(null);
                  setLocation(registrationUploadPath(id));
                }}
              >
                <Upload className="mr-1.5 h-4 w-4" />
                Upload Result
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className="w-full" onClick={resetRegistrationForm}>
              Register Another Patient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
