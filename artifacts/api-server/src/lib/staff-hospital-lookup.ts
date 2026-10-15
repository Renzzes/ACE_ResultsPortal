import type { HospitalPatientRecord, Patient, User } from "@workspace/db";
import { PORTAL_USER_ROLE } from "@workspace/db/lite";
import type { DepartmentLookup } from "./department-resolver";
import { resolveRegistrationDepartment, type RegistrationDepartment } from "./patient-department-access";

export const STAFF_HOSPITAL_LOOKUP_UNAVAILABLE =
  "Unable to verify the hospital record right now. Please try again.";

export type StaffLookupAction =
  | "NOT_FOUND"
  | "NOT_ELIGIBLE"
  | "AMBIGUOUS"
  | "CONTINUE_REGISTRATION"
  | "USE_EXISTING_PATIENT"
  | "USE_EXISTING_ACCOUNT"
  | "ACCOUNT_NEEDS_RESOLUTION";

export type PortalLinkState = "none" | "valid" | "needs_resolution";

export type StaffHospitalLookupBody = {
  hospitalRecordFound: boolean;
  portalPatientFound: boolean;
  portalAccountFound: boolean;
  departmentMembershipExists: boolean | null;
  action: StaffLookupAction;
  message: string;
  patientHisId?: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  dateOfBirth?: string;
  patientId?: number;
  reuseToken?: string;
};

const MESSAGES: Record<StaffLookupAction, string> = {
  NOT_FOUND: "No hospital record was found.",
  NOT_ELIGIBLE: "This hospital record cannot be registered.",
  AMBIGUOUS: "More than one hospital record matched. The patient was not selected automatically.",
  CONTINUE_REGISTRATION: "Hospital Record Verified — No ACE Results Portal Account Found",
  USE_EXISTING_PATIENT: "Hospital record verified. This patient is already in the portal and has no portal account.",
  USE_EXISTING_ACCOUNT: "Already have an Account and Hospital Record Verified – Use Existing Account",
  ACCOUNT_NEEDS_RESOLUTION:
    "This patient already exists, but the linked portal account needs resolution. A second patient was not created.",
};

export function portalLinkState(user: Pick<User, "role" | "isActive"> | undefined): PortalLinkState {
  if (!user) return "needs_resolution";
  if (!user.isActive || user.role !== PORTAL_USER_ROLE) return "needs_resolution";
  return "valid";
}

export function classifyStaffHospitalLookup(input: {
  hospital: "none" | "ambiguous" | "ineligible" | "found";
  portalPatientFound: boolean;
  portalLink: PortalLinkState;
  departmentMembershipExists: boolean | null;
}): Pick<
  StaffHospitalLookupBody,
  | "hospitalRecordFound"
  | "portalPatientFound"
  | "portalAccountFound"
  | "departmentMembershipExists"
  | "action"
  | "message"
> {
  if (input.hospital === "ambiguous") {
    return {
      hospitalRecordFound: false,
      portalPatientFound: false,
      portalAccountFound: false,
      departmentMembershipExists: null,
      action: "AMBIGUOUS",
      message: MESSAGES.AMBIGUOUS,
    };
  }
  if (input.hospital === "none") {
    return {
      hospitalRecordFound: false,
      portalPatientFound: false,
      portalAccountFound: false,
      departmentMembershipExists: null,
      action: "NOT_FOUND",
      message: MESSAGES.NOT_FOUND,
    };
  }
  if (input.hospital === "ineligible") {
    return {
      hospitalRecordFound: true,
      portalPatientFound: false,
      portalAccountFound: false,
      departmentMembershipExists: null,
      action: "NOT_ELIGIBLE",
      message: MESSAGES.NOT_ELIGIBLE,
    };
  }

  if (!input.portalPatientFound) {
    return {
      hospitalRecordFound: true,
      portalPatientFound: false,
      portalAccountFound: false,
      departmentMembershipExists: null,
      action: "CONTINUE_REGISTRATION",
      message: MESSAGES.CONTINUE_REGISTRATION,
    };
  }

  if (input.portalLink === "needs_resolution") {
    return {
      hospitalRecordFound: true,
      portalPatientFound: true,
      portalAccountFound: false,
      departmentMembershipExists: input.departmentMembershipExists,
      action: "ACCOUNT_NEEDS_RESOLUTION",
      message: MESSAGES.ACCOUNT_NEEDS_RESOLUTION,
    };
  }

  if (input.portalLink === "valid") {
    return {
      hospitalRecordFound: true,
      portalPatientFound: true,
      portalAccountFound: true,
      departmentMembershipExists: input.departmentMembershipExists,
      action: "USE_EXISTING_ACCOUNT",
      message: MESSAGES.USE_EXISTING_ACCOUNT,
    };
  }

  return {
    hospitalRecordFound: true,
    portalPatientFound: true,
    portalAccountFound: false,
    departmentMembershipExists: input.departmentMembershipExists,
    action: "USE_EXISTING_PATIENT",
    message: MESSAGES.USE_EXISTING_PATIENT,
  };
}

export function reuseAction(action: StaffLookupAction): boolean {
  return (
    action === "USE_EXISTING_PATIENT" ||
    action === "USE_EXISTING_ACCOUNT" ||
    action === "ACCOUNT_NEEDS_RESOLUTION"
  );
}

/**
 * A create request for an existing hospital id never inserts another patient.
 * Membership is written only when the lookup token matches this staff user,
 * this hospital id, and the server-resolved department.
 */
export function existingPatientCreateDecision(input: {
  token: { patientHisId: string; staffUserId: number; departmentId: number | null } | null;
  staffUserId: number;
  hospitalHisId: string;
  registration: RegistrationDepartment;
  clientDepartmentId?: number | null;
}): "link" | "conflict" | "forbidden" {
  void input.clientDepartmentId;
  const token = input.token;
  if (!token) return "conflict";
  if (token.staffUserId !== input.staffUserId) return "forbidden";
  if (token.patientHisId.trim() !== input.hospitalHisId.trim()) return "conflict";
  if (input.registration.status === "department") {
    if (token.departmentId !== input.registration.departmentId) return "forbidden";
    return "link";
  }
  if (input.registration.status === "none") {
    if (token.departmentId !== null) return "forbidden";
    return "link";
  }
  return "forbidden";
}

export type HospitalMatchResult =
  | { status: "none" }
  | { status: "ambiguous" }
  | { status: "one"; record: HospitalPatientRecord };

export async function assembleStaffHospitalLookup(input: {
  role: string;
  staffUserId: number;
  matches: HospitalMatchResult;
  findPortalPatient: (patientHisId: string) => Promise<Pick<Patient, "id" | "portalUserId" | "patientHisId"> | undefined>;
  findPortalUser: (userId: number) => Promise<Pick<User, "id" | "role" | "isActive"> | undefined>;
  membershipExists: (patientId: number, departmentId: number) => Promise<boolean>;
  signReuseToken: (payload: {
    patientHisId: string;
    staffUserId: number;
    departmentId: number | null;
  }) => string;
  lookupDepartment?: DepartmentLookup;
}): Promise<
  | { ok: true; body: StaffHospitalLookupBody }
  | { ok: false; status: 403 | 500; error: string }
> {
  const registration = await resolveRegistrationDepartment(input.role, input.lookupDepartment);
  if (registration.status === "misconfigured") {
    return { ok: false, status: 500, error: "Unable to authorize this request." };
  }
  if (registration.status === "forbidden" || registration.status === "not_staff") {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (input.matches.status !== "one") {
    const classified = classifyStaffHospitalLookup({
      hospital: input.matches.status === "ambiguous" ? "ambiguous" : "none",
      portalPatientFound: false,
      portalLink: "none",
      departmentMembershipExists: null,
    });
    return { ok: true, body: classified };
  }

  const record = input.matches.record;
  const portalPatient = await input.findPortalPatient(record.patientHisId);

  if (record.isDeceased && !portalPatient) {
    return {
      ok: true,
      body: {
        ...classifyStaffHospitalLookup({
          hospital: "ineligible",
          portalPatientFound: false,
          portalLink: "none",
          departmentMembershipExists: null,
        }),
        patientHisId: record.patientHisId,
        firstName: record.firstName,
        middleName: record.middleName,
        lastName: record.lastName,
        dateOfBirth: record.dateOfBirth,
      },
    };
  }
  let portalLink: PortalLinkState = "none";
  if (portalPatient?.portalUserId != null) {
    const user = await input.findPortalUser(portalPatient.portalUserId);
    portalLink = portalLinkState(user);
  }

  let departmentMembershipExists: boolean | null = null;
  if (portalPatient && registration.status === "department") {
    departmentMembershipExists = await input.membershipExists(portalPatient.id, registration.departmentId);
  }

  const classified = classifyStaffHospitalLookup({
    hospital: "found",
    portalPatientFound: Boolean(portalPatient),
    portalLink,
    departmentMembershipExists,
  });

  const body: StaffHospitalLookupBody = {
    ...classified,
    patientHisId: record.patientHisId,
    firstName: record.firstName,
    middleName: record.middleName,
    lastName: record.lastName,
    dateOfBirth: record.dateOfBirth,
  };
  if (portalPatient) body.patientId = portalPatient.id;
  if (portalPatient && reuseAction(classified.action)) {
    body.reuseToken = input.signReuseToken({
      patientHisId: record.patientHisId,
      staffUserId: input.staffUserId,
      departmentId: registration.status === "department" ? registration.departmentId : null,
    });
  }
  return { ok: true, body };
}
