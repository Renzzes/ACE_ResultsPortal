import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRegenerateAccessCode } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PasswordDialog } from "@/components/admin/account-dialog";
import { AdminCard, AdminTable, StatusPill } from "@/components/admin/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { fetchAdminPatientAccounts } from "@/lib/admin-api";
import { type AdminPatientAccount } from "@/lib/admin-mock-data";
import { Eye, KeyRound, Mail, RefreshCw } from "lucide-react";

const STRONG_PASSWORD = /^(?=.*\d)(?=.*[A-Z])(?=.*[a-z])(?=.*[^A-Za-z0-9]).{8,}$/;

async function resetPortalPassword(patientId: number, newPassword: string) {
  const token = sessionStorage.getItem("ace_access_token");
  const response = await fetch(`/api/patients/${patientId}/reset-portal-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ newPassword }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Could not reset password");
  }
}

async function emailAccessCode(patientId: number) {
  const token = sessionStorage.getItem("ace_access_token");
  const response = await fetch(`/api/patients/${patientId}/email-access-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Could not email access code");
  }
  return body as { message?: string; accessCode?: string };
}

function toPatient(row: {
  id: number;
  patientHisId: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
  createdAt: string;
  resultCount?: number;
  accessCodeRequestedAt?: string | null;
  dateOfBirth?: string | null;
  portalActive?: boolean;
}): AdminPatientAccount {
  return {
    id: row.id,
    patientHisId: row.patientHisId,
    firstName: row.firstName,
    lastName: row.lastName,
    middleName: row.middleName ?? null,
    email: row.email ?? "",
    mobileNumber: row.mobileNumber ?? "",
    createdAt: row.createdAt,
    resultCount: row.resultCount ?? 0,
    portalActive: row.portalActive === true,
    accessCodeRequestedAt: row.accessCodeRequestedAt ?? null,
    dateOfBirth: row.dateOfBirth ?? null,
  };
}

function formatDateOfBirth(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return "Not recorded";
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export default function AdminPatientsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<AdminPatientAccount | null>(null);
  const [passwordFor, setPasswordFor] = useState<AdminPatientAccount | null>(null);
  const [resetting, setResetting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(null);

  const params = { search: search || undefined, limit: 50 };
  const { data, isLoading } = useQuery({
    queryKey: ["admin-patient-accounts", params.search, params.limit],
    queryFn: () => fetchAdminPatientAccounts(params),
  });
  const regenerate = useRegenerateAccessCode();

  const live = useMemo(() => (data?.data ?? []).map(toPatient), [data]);
  const patients = live;

  async function onResetPassword(password: string) {
    if (!passwordFor) return;
    if (!STRONG_PASSWORD.test(password)) {
      toast({
        title: "Password is too weak",
        description: "Use 8+ characters with upper, lower, number, and special character.",
        variant: "destructive",
      });
      return;
    }
    setResetting(true);
    try {
      await resetPortalPassword(passwordFor.id, password);
      toast({ title: `Portal password updated for ${passwordFor.firstName} ${passwordFor.lastName}` });
      setPasswordFor(null);
    } catch (error) {
      toast({
        title: "Could not reset password",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  }

  function onRegenCode(patient: AdminPatientAccount) {
    regenerate.mutate(
      { id: patient.id },
      {
        onSuccess: (result) => {
          setAccessCode(result.accessCode ?? null);
          setViewing({ ...patient, accessCodeRequestedAt: null });
          void queryClient.invalidateQueries({ queryKey: ["admin-patient-accounts"] });
          toast({ title: "New access code issued", description: "Previous code no longer works." });
        },
        onError: () => toast({ title: "Could not issue access code", variant: "destructive" }),
      },
    );
  }

  async function onIssueAndEmailAccessCode() {
    if (!viewing) return;
    setEmailing(true);
    try {
      const result = await emailAccessCode(viewing.id);
      if (result.accessCode) setAccessCode(result.accessCode);
      setViewing({ ...viewing, accessCodeRequestedAt: null });
      void queryClient.invalidateQueries({ queryKey: ["admin-patient-accounts"] });
      toast({
        title: "New access code issued & emailed",
        description: result.message ?? `Sent to ${viewing.email || "patient email"}. Previous code no longer works.`,
      });
    } catch (error) {
      toast({
        title: "Could not issue and email access code",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setEmailing(false);
    }
  }

  return (
    <AdminLayout title="Patient accounts" fill>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#64706A]">
            View portal accounts and access-code requests. Patient access codes do not expire unless staff
            issues a replacement (for example after Forgot Access Code). Each issue creates a new code — the
            previous one stops working.
          </p>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, HIS ID, or email…"
            className="w-full border-[#DDE5E0] bg-white sm:w-72"
          />
        </div>

        <AdminCard className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AdminTable
            headers={["Patient", "HIS ID", "Email", "Results", "Access code request", "Portal", ""]}
            loading={isLoading && patients.length === 0}
            empty={!isLoading && patients.length === 0 ? "No patient accounts found." : undefined}
          >
            {patients.map((patient) => (
              <tr key={patient.id} className="hover:bg-[#F6F4EF]/80">
                <td className="px-4 py-3 font-semibold text-[#17221D]">
                  {patient.firstName} {patient.middleName ? `${patient.middleName} ` : ""}
                  {patient.lastName}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[#64706A]">{patient.patientHisId}</td>
                <td className="px-4 py-3 text-[#64706A]">{patient.email || "—"}</td>
                <td className="px-4 py-3 tabular-nums text-[#17221D]">{patient.resultCount}</td>
                <td className="px-4 py-3">
                  {patient.accessCodeRequestedAt ? (
                    <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                      Requested
                    </span>
                  ) : (
                    <span className="text-xs text-[#64706A]">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill active={patient.portalActive} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-[#64706A] hover:bg-[#F6F4EF]"
                      aria-label="View account"
                      onClick={() => {
                        setAccessCode(null);
                        setViewing(patient);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-[#64706A] hover:bg-[#F6F4EF]"
                      aria-label="Reset password"
                      onClick={() => setPasswordFor(patient)}
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-[#64706A] hover:bg-[#F6F4EF]"
                      aria-label="Issue new access code"
                      onClick={() => onRegenCode(patient)}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      </div>

      <Dialog
        open={Boolean(viewing)}
        onOpenChange={(open) => {
          if (!open) {
            setViewing(null);
            setAccessCode(null);
          }
        }}
      >
        <DialogContent className="w-[min(96vw,32rem)] sm:rounded-2xl">
          <DialogHeader className="text-left">
            <DialogTitle className="text-[#153D2B]">Patient account</DialogTitle>
            <DialogDescription className="text-[#64706A]">
              Portal login details, not the hospital chart.
            </DialogDescription>
          </DialogHeader>
          {viewing ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Cell label="Display name" value={`${viewing.firstName} ${viewing.lastName}`} />
              <Cell label="HIS ID" value={viewing.patientHisId} />
              <Cell label="Date of birth" value={formatDateOfBirth(viewing.dateOfBirth)} />
              <Cell label="Email" value={viewing.email || "—"} />
              <Cell label="Phone" value={viewing.mobileNumber || "—"} />
              <Cell label="Results on file" value={String(viewing.resultCount)} />
              <Cell label="Portal" value={viewing.portalActive ? "Active" : "Inactive"} />
              <Cell
                label="Access code request"
                value={viewing.accessCodeRequestedAt ? "Requested — issue & email a new code" : "None"}
              />
              {accessCode ? <Cell label="New access code (shown once)" value={accessCode} /> : null}
            </dl>
          ) : null}
          {viewing ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-[#64706A]">
                Codes do not expire for the patient. Issuing again always creates a <strong>new</strong> code
                and invalidates the old one. Take note if you only issue without email.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 gap-2 border-[#DDE5E0]"
                  disabled={regenerate.isPending}
                  onClick={() => onRegenCode(viewing)}
                >
                  <RefreshCw className="h-4 w-4" />
                  {regenerate.isPending ? "Issuing…" : "Issue New Access Code"}
                </Button>
                <Button
                  type="button"
                  className="h-11 flex-1 gap-2 bg-[#2F7D4A] text-white hover:bg-[#25653C]"
                  disabled={emailing || !viewing.email}
                  onClick={() => void onIssueAndEmailAccessCode()}
                >
                  <Mail className="h-4 w-4" />
                  {emailing ? "Sending…" : "Issue & Email New Code"}
                </Button>
              </div>
              {!viewing.email ? (
                <p className="text-xs text-red-600">This patient has no portal email on file.</p>
              ) : null}
            </div>
          ) : null}
          {viewing ? (
            <Link href={`/patients/${viewing.id}`} className="mt-2 inline-flex text-sm font-semibold text-[#2F7D4A]">
              Open hospital record
            </Link>
          ) : null}
        </DialogContent>
      </Dialog>

      <PasswordDialog
        open={Boolean(passwordFor)}
        onOpenChange={(open) => {
          if (!open) setPasswordFor(null);
        }}
        title={`Reset portal password · ${passwordFor ? `${passwordFor.firstName} ${passwordFor.lastName}` : ""}`}
        description="This updates the patient portal password. Use 8+ characters with upper, lower, number, and special character."
        pending={resetting}
        onSubmit={(password) => void onResetPassword(password)}
      />
    </AdminLayout>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[#64706A]">{label}</dt>
      <dd className="mt-0.5 break-all font-semibold text-[#17221D]">{value}</dd>
    </div>
  );
}
