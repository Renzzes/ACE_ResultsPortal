import { PatientDepartmentSchemaError } from "@workspace/db/lite";
import * as patientDepartmentsRepo from "@workspace/db/repos/patient-departments";
import {
  resolveStaffDepartment,
  type DepartmentLookup,
  type StaffDepartmentResolution,
} from "./department-resolver";

export const PATIENT_DEPARTMENT_SCHEMA_MESSAGE =
  "Patient department membership is not installed. Run docs/migration/sql/013_patient_departments.sql against ACE_ResultsPortal.";

export type StaffPatientAccess =
  | { status: "global" }
  | { status: "physician" }
  | { status: "membership"; departmentId: number }
  | { status: "forbidden" }
  | { status: "misconfigured" }
  | { status: "none" };

export type RegistrationDepartment =
  | { status: "none" }
  | { status: "department"; departmentId: number }
  | { status: "not_staff" }
  | { status: "forbidden" }
  | { status: "misconfigured" };

export type PatientDepartmentStore = {
  listPatientIdsForDepartment: (departmentId: number) => Promise<number[]>;
  patientBelongsToDepartment: (patientId: number, departmentId: number) => Promise<boolean>;
  ensureMembership: (input: {
    patientId: number;
    departmentId: number;
    registeredById: number | null;
  }) => Promise<{ created: boolean }>;
  listDepartmentIdsForPatient: (patientId: number) => Promise<number[]>;
};

export type DepartmentPatientConstraint =
  | { kind: "all" }
  | { kind: "physician" }
  | { kind: "ids"; departmentId: number; ids: number[] }
  | { kind: "error"; status: 403 | 500 | 503; error: string };

const GENERIC_AUTH_ERROR = "Unable to authorize this request.";

function failureStatus(resolved: StaffDepartmentResolution): StaffPatientAccess {
  if (!resolved.ok && resolved.reason === "invalid_scope") return { status: "misconfigured" };
  return { status: "forbidden" };
}

/**
 * result_scope "all" (Medical Records) stays global.
 * Restricted departments must have an explicit patient_departments row.
 */
export function accessFromResolution(resolved: StaffDepartmentResolution): StaffPatientAccess {
  if (!resolved.ok) return failureStatus(resolved);
  if (resolved.kind === "global") return { status: "global" };
  if (resolved.kind === "not_department") {
    if (resolved.role === "physician") return { status: "physician" };
    return { status: "none" };
  }
  if (resolved.department.resultScope === "all") return { status: "global" };
  return { status: "membership", departmentId: resolved.department.id };
}

export async function resolveStaffPatientAccess(
  role: string,
  lookup?: DepartmentLookup,
): Promise<StaffPatientAccess> {
  return accessFromResolution(await resolveStaffDepartment(role, lookup));
}

/** Department to record when this account registers or reuses a patient. super_admin has none. */
export async function resolveRegistrationDepartment(
  role: string,
  lookup?: DepartmentLookup,
): Promise<RegistrationDepartment> {
  const resolved = await resolveStaffDepartment(role, lookup);
  if (!resolved.ok) {
    if (resolved.reason === "invalid_scope") return { status: "misconfigured" };
    return { status: "forbidden" };
  }
  if (resolved.kind === "global") return { status: "none" };
  if (resolved.kind === "not_department") return { status: "not_staff" };
  return { status: "department", departmentId: resolved.department.id };
}

function schemaFailure(err: unknown): { status: 503; error: string } | null {
  if (err instanceof PatientDepartmentSchemaError) {
    return { status: 503, error: PATIENT_DEPARTMENT_SCHEMA_MESSAGE };
  }
  return null;
}

const defaultStore: PatientDepartmentStore = {
  listPatientIdsForDepartment: (departmentId) =>
    patientDepartmentsRepo.listPatientIdsForDepartment(departmentId),
  patientBelongsToDepartment: async (patientId, departmentId) => {
    const row = await patientDepartmentsRepo.findMembership(patientId, departmentId);
    return Boolean(row);
  },
  ensureMembership: async (input) => {
    const result = await patientDepartmentsRepo.ensureMembership(input);
    return { created: result.created };
  },
  listDepartmentIdsForPatient: async (patientId) => {
    const rows = await patientDepartmentsRepo.listForPatient(patientId);
    return rows.map((row) => row.departmentId);
  },
};

export async function staffDirectoryConstraint(
  role: string,
  lookup?: DepartmentLookup,
  store: PatientDepartmentStore = defaultStore,
): Promise<DepartmentPatientConstraint> {
  const access = await resolveStaffPatientAccess(role, lookup);
  if (access.status === "misconfigured") return { kind: "error", status: 500, error: GENERIC_AUTH_ERROR };
  if (access.status === "forbidden" || access.status === "none") {
    return { kind: "error", status: 403, error: "Forbidden" };
  }
  if (access.status === "global") return { kind: "all" };
  if (access.status === "physician") return { kind: "physician" };
  try {
    const ids = await store.listPatientIdsForDepartment(access.departmentId);
    return { kind: "ids", departmentId: access.departmentId, ids };
  } catch (err) {
    const schema = schemaFailure(err);
    if (schema) return { kind: "error", status: schema.status, error: schema.error };
    throw err;
  }
}

export async function assertStaffMayAccessPatient(
  role: string,
  patientId: number,
  lookup?: DepartmentLookup,
  store: PatientDepartmentStore = defaultStore,
): Promise<{ ok: true } | { ok: false; status: 403 | 500 | 503; error: string }> {
  const access = await resolveStaffPatientAccess(role, lookup);
  if (access.status === "misconfigured") return { ok: false, status: 500, error: GENERIC_AUTH_ERROR };
  if (access.status === "global") return { ok: true };
  if (access.status !== "membership") return { ok: false, status: 403, error: "Forbidden" };
  try {
    const belongs = await store.patientBelongsToDepartment(patientId, access.departmentId);
    if (!belongs) return { ok: false, status: 403, error: "Forbidden" };
    return { ok: true };
  } catch (err) {
    const schema = schemaFailure(err);
    if (schema) return { ok: false, status: schema.status, error: schema.error };
    throw err;
  }
}

export type MembershipRow = {
  patientId: number;
  departmentId: number;
  registeredById: number | null;
};

/** In-memory membership set for tests. Performs no SQL. */
export function createMemoryPatientDepartmentStore(
  seed: readonly MembershipRow[] = [],
): PatientDepartmentStore & { rows: MembershipRow[] } {
  const rows: MembershipRow[] = seed.map((row) => ({ ...row }));
  return {
    rows,
    async listPatientIdsForDepartment(departmentId) {
      return rows.filter((row) => row.departmentId === departmentId).map((row) => row.patientId);
    },
    async patientBelongsToDepartment(patientId, departmentId) {
      return rows.some((row) => row.patientId === patientId && row.departmentId === departmentId);
    },
    async listDepartmentIdsForPatient(patientId) {
      return rows.filter((row) => row.patientId === patientId).map((row) => row.departmentId);
    },
    async ensureMembership(input) {
      const exists = rows.some(
        (row) => row.patientId === input.patientId && row.departmentId === input.departmentId,
      );
      if (exists) return { created: false };
      rows.push({
        patientId: input.patientId,
        departmentId: input.departmentId,
        registeredById: input.registeredById,
      });
      return { created: true };
    },
  };
}
