import type { ResultCategory, ResultRow, UserRole } from "@workspace/db";
import { roleHasPermission } from "@workspace/db";
import { resolveResultCategoryScope, type DepartmentLookup } from "./department-resolver";
import { AppError } from "./errors";

export const STAFF_ROLES: UserRole[] = [
  "super_admin",
  "medical_records",
  "laboratory",
  "radiology",
  "endoscopy",
  "physician",
];

export {
  categoriesForResultScope,
  resolveResultCategoryScope,
  resolveServerUploadCategory,
  resolveStaffDepartment,
  requestedCategoryWithinScope,
  scopeFailure,
  lookupDepartments,
  type CategoryAuthorization,
  type DepartmentLookup,
  type StaffDepartment,
  type StaffDepartmentResolution,
} from "./department-resolver";

export function canManageUsers(role: string): boolean {
  return roleHasPermission(role, "users");
}

export function canCreatePatients(role: string): boolean {
  // Physicians may have the coarse `patients` flag for assignment-scoped listing,
  // but they must not create portal patient accounts.
  return roleHasPermission(role, "patients") && role !== "physician";
}

export function canEditPatients(role: string): boolean {
  return roleHasPermission(role, "patients") && (role === "super_admin" || role === "medical_records");
}

export function canDeletePatients(role: string): boolean {
  return roleHasPermission(role, "patients") && (role === "super_admin" || role === "medical_records");
}

export function canRegenerateAccessCode(role: string): boolean {
  return roleHasPermission(role, "patients") && role !== "physician";
}

export function canAssignPhysicians(role: string): boolean {
  return roleHasPermission(role, "patients") && (role === "super_admin" || role === "medical_records");
}

export function canUploadResults(role: string): boolean {
  // File upload is controlled by the dedicated upload_results Admin permission.
  // Coarse "results" still gates release/archive via canMutateResultMetadata.
  return roleHasPermission(role, "upload_results") && role !== "physician" && role !== "patient";
}

export async function canUploadCategory(
  role: string,
  category: string,
  lookup?: DepartmentLookup,
): Promise<boolean> {
  if (!canUploadResults(role)) return false;
  const scope = await resolveResultCategoryScope(role, lookup);
  if (scope.status === "misconfigured") {
    throw new AppError(500, "Unable to authorize this request.");
  }
  if (scope.status !== "ok") return false;
  if (scope.categories === "all") return true;
  return scope.categories.includes(category as ResultCategory);
}

export function canMutateResultMetadata(role: string): boolean {
  return roleHasPermission(role, "results") && role !== "physician";
}

export function canReleaseResult(role: string): boolean {
  return canMutateResultMetadata(role);
}

export function canArchiveResult(role: string): boolean {
  return canMutateResultMetadata(role);
}

export function canDeleteResult(role: string): boolean {
  return roleHasPermission(role, "results") && (role === "super_admin" || role === "medical_records");
}

export function canRestoreArchive(role: string): boolean {
  return roleHasPermission(role, "archive");
}

export function canListArchive(role: string): boolean {
  return roleHasPermission(role, "archive");
}

export function canViewAuditLogs(role: string): boolean {
  return roleHasPermission(role, "audit");
}

export function canViewDashboardDetails(role: string): boolean {
  return role === "super_admin" || role === "medical_records";
}

export function canSearchAsPhysician(role: string): boolean {
  return role === "physician" || role === "super_admin";
}

export function canAccessSystemSettings(role: string): boolean {
  return roleHasPermission(role, "settings");
}

export async function resultInDepartmentScope(
  role: string,
  result: Pick<ResultRow, "category">,
  lookup?: DepartmentLookup,
): Promise<boolean> {
  const scope = await resolveResultCategoryScope(role, lookup);
  if (scope.status === "misconfigured") {
    throw new AppError(500, "Unable to authorize this request.");
  }
  if (scope.status !== "ok") return false;
  if (scope.categories === "all") return true;
  return scope.categories.includes(result.category);
}

export function isDepartmentStaffRole(role: string): boolean {
  return role !== "super_admin" && role !== "physician" && role !== "patient";
}
