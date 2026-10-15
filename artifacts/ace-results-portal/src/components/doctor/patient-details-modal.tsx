import { useState } from "react";
import { Link } from "wouter";
import { FileText, MessageCircle, Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PatientAvatar, ageFromDob } from "@/components/doctor/shared";
import { ClinicCallDialog } from "@/components/doctor/call-dialog";
import type { Patient } from "@workspace/api-client-react";

/** Live patient detail modal — no fabricated clinical fields. */
export function PatientDetailsModal({
  open,
  onOpenChange,
  patient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
}) {
  const [callOpen, setCallOpen] = useState(false);
  if (!patient) return null;

  const age = ageFromDob(patient.dateOfBirth);
  const fullName = `${patient.lastName}, ${patient.firstName}`;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="doctor-shell max-w-lg border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-card))]">
          <DialogTitle className="text-[hsl(var(--doc-text))]">{fullName}</DialogTitle>
          <DialogDescription className="doc-muted">
            {patient.patientHisId}
            {age != null ? ` · ${age} years` : ""}
          </DialogDescription>
          <div className="flex items-center gap-3 pt-2">
            <PatientAvatar firstName={patient.firstName} lastName={patient.lastName} size="lg" />
            <div className="text-sm text-[hsl(var(--doc-text))] space-y-1">
              <p>DOB: {new Date(patient.dateOfBirth).toLocaleDateString("en-PH")}</p>
              <p>Mobile: {patient.mobileNumber ?? "Not recorded"}</p>
              <p>Email: {patient.email ?? "Not recorded"}</p>
              <p>Released results: {patient.resultCount ?? 0}</p>
            </div>
          </div>
          <p className="text-xs doc-muted mt-2">
            Allergies, vitals, and visit notes are not stored in ACE_ResultsPortal for this phase.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={!patient.mobileNumber}
              onClick={() => setCallOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[hsl(var(--doc-green))] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </button>
            <Link
              href={`/physician/patients/${patient.id}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[hsl(var(--doc-border))] px-3 py-2 text-xs font-semibold text-[hsl(var(--doc-text))] no-underline"
            >
              <FileText className="h-3.5 w-3.5" />
              Open file
            </Link>
            <Link
              href="/physician/messages"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[hsl(var(--doc-border))] px-3 py-2 text-xs font-semibold text-[hsl(var(--doc-text))] no-underline"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Message
            </Link>
          </div>
        </DialogContent>
      </Dialog>
      <ClinicCallDialog
        open={callOpen}
        onOpenChange={setCallOpen}
        firstName={patient.firstName}
        lastName={patient.lastName}
        patientHisId={patient.patientHisId}
        mobileNumber={patient.mobileNumber}
      />
    </>
  );
}
