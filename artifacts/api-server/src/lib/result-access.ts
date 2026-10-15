import {
  departmentsRepo,
  PatientDepartmentSchemaError,
  patientDepartmentsRepo,
  patientPhysiciansRepo,
  resultPhysiciansRepo,
  usersRepo,
  type ResultRow,
  type User,
} from "@workspace/db";
import type { AuthUser } from "../middlewares/auth";
import { AppError } from "./errors";
import {
  PATIENT_DEPARTMENT_SCHEMA_MESSAGE,
  resolveStaffPatientAccess,
} from "./patient-department-access";
import type { DepartmentLookup } from "./department-resolver";
import { canMutateResultMetadata, resultInDepartmentScope } from "./rbac";

/**
 * Patient portal access is independent of physician assignment.
 * Only own patient + released status (existing Phase 3/6 rules).
 */
export function canPortalAccessResult(
  result: Pick<ResultRow, "patientId" | "status">,
  patientId: number,
): boolean {
  return result.patientId === patientId && result.status === "released";
}

export type ResultAccessDeps = {
  hasResultAssignments: (resultId: number) => Promise<boolean>;
  findResultAssignment: (
    resultId: number,
    physicianId: number,
  ) => Promise<{ id: number } | undefined | null>;
  findPatientAssignment: (
    patientId: number,
    physicianId: number,
  ) => Promise<{ id: number } | undefined | null>;
  /** Re-check live role/active status (inactive or role-changed users lose access). */
  resolveActor: (userId: number) => Promise<{ role: string; isActive: boolean } | undefined>;
  /** Server-side department lookup. Tests may inject a fixture. Production reads dbo.departments. */
  lookupDepartment?: DepartmentLookup;
  /**
   * Restricted departments must belong via patient_departments.
   * Tests inject this so category checks do not query SQL.
   */
  patientBelongsToDepartment?: (patientId: number, departmentId: number) => Promise<boolean>;
};

const defaultAccessDeps: ResultAccessDeps = {
  hasResultAssignments: (resultId) => resultPhysiciansRepo.hasAssignments(resultId),
  findResultAssignment: (resultId, physicianId) =>
    resultPhysiciansRepo.findAssignment(resultId, physicianId),
  findPatientAssignment: (patientId, physicianId) =>
    patientPhysiciansRepo.findAssignment(patientId, physicianId),
  resolveActor: async (userId) => {
    const user = await usersRepo.findUserById(userId);
    return user ? { role: user.role, isActive: user.isActive } : undefined;
  },
  lookupDepartment: (code) => departmentsRepo.findDepartmentByCode(code),
  patientBelongsToDepartment: async (patientId, departmentId) => {
    const row = await patientDepartmentsRepo.findMembership(patientId, departmentId);
    return Boolean(row);
  },
};

/**
 * Result access (Phase 7C):
 * - Staff: department result_scope plus patient_departments for restricted departments.
 *   super_admin and result_scope "all" stay global.
 * - Physician private copy: if result_physicians rows exist → only those physicians
 *   (pending or released). This is READ-ONLY continuity-of-care access, not approval.
 * - Else: released + patient_physicians (existing Phase 3/5 behavior).
 * - Patient portal: canPortalAccessResult only — never gated by assignment.
 */
export async function canAccessResult(
  user: AuthUser,
  result: ResultRow,
  deps: Partial<ResultAccessDeps> = {},
): Promise<boolean> {
  const resolvedDeps: ResultAccessDeps = { ...defaultAccessDeps, ...deps };
  if (user.role === "super_admin") return true;
  if (user.role === "physician") {
    const actor = await resolvedDeps.resolveActor(user.userId);
    if (!actor || !actor.isActive || actor.role !== "physician") return false;
    if (result.status === "archived") return false;

    const privatelyAssigned = await resolvedDeps.hasResultAssignments(result.id);
    if (privatelyAssigned) {
      const copy = await resolvedDeps.findResultAssignment(result.id, user.userId);
      return Boolean(copy);
    }

    if (result.status !== "released") return false;
    const assignment = await resolvedDeps.findPatientAssignment(result.patientId, user.userId);
    return Boolean(assignment);
  }
  if (user.role === "patient") return false;
  const lookup = resolvedDeps.lookupDepartment ?? defaultAccessDeps.lookupDepartment;
  const inScope = await resultInDepartmentScope(user.role, result, lookup);
  if (!inScope) return false;
  const access = await resolveStaffPatientAccess(user.role, lookup);
  if (access.status === "global") return true;
  if (access.status !== "membership") return false;
  const belongs = resolvedDeps.patientBelongsToDepartment ?? defaultAccessDeps.patientBelongsToDepartment;
  if (!belongs) return false;
  try {
    return await belongs(result.patientId, access.departmentId);
  } catch (err) {
    if (err instanceof PatientDepartmentSchemaError) {
      throw new AppError(503, PATIENT_DEPARTMENT_SCHEMA_MESSAGE);
    }
    throw err;
  }
}

/** Physicians never mutate results; staff must pass role + scope checks. */
export async function canMutateResult(
  user: AuthUser,
  result: ResultRow,
  deps: Partial<ResultAccessDeps> = {},
): Promise<boolean> {
  if (!canMutateResultMetadata(user.role)) return false;
  return canAccessResult(user, result, deps);
}

export type AssignablePhysicianDeps = {
  findUserById: (id: number) => Promise<User | undefined>;
};

/** Validate a client-supplied physician id for optional result copy assignment. */
export async function assertAssignablePhysician(
  physicianId: number,
  deps: AssignablePhysicianDeps = { findUserById: usersRepo.findUserById },
): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const user = await deps.findUserById(physicianId);
  if (!user || !user.isActive || user.role !== "physician") {
    return { ok: false, error: "Assigned doctor must be an active physician." };
  }
  return { ok: true, userId: user.id };
}
