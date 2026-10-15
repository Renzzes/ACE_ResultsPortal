import type { ResultCategory } from "@workspace/db/lite";
import * as departmentsRepo from "@workspace/db/repos/departments";
import type { Department, DepartmentResultScope } from "@workspace/db/repos/departments";

/**
 * Scope enum → result categories.
 * This is the meaning of dbo.departments.result_scope, not a role→category map.
 * Unknown values fail closed (null). They are never treated as "all".
 */
const RESULT_SCOPE_CATEGORIES: Record<DepartmentResultScope, ResultCategory[] | "all"> = {
  all: "all",
  laboratory: ["laboratory"],
  radiology: [
    "radiology",
    "ultrasound",
    "ct_scan",
    "mri",
    "ecg",
    "echo_2d",
    "rehabilitation",
    "other",
  ],
  other: ["other"],
};

const KNOWN_RESULT_SCOPES = new Set<string>(Object.keys(RESULT_SCOPE_CATEGORIES));

const ALL_RESULT_CATEGORIES: readonly ResultCategory[] = [
  "laboratory",
  "radiology",
  "ultrasound",
  "ct_scan",
  "mri",
  "ecg",
  "echo_2d",
  "rehabilitation",
  "other",
];

/** Roles that are global or non-department. They are not dbo.departments codes. */
const GLOBAL_ADMIN_ROLE = "super_admin";
const NON_DEPARTMENT_ROLES = new Set(["physician", "patient"]);

export type StaffDepartment = {
  id: number;
  code: string;
  name: string;
  resultScope: DepartmentResultScope;
  isActive: boolean;
};

export type DepartmentLookup = (code: string) => Promise<Department | undefined>;

export type StaffDepartmentResolution =
  | { ok: true; kind: "global" }
  | { ok: true; kind: "not_department"; role: "physician" | "patient" }
  | { ok: true; kind: "department"; department: StaffDepartment }
  | { ok: false; reason: "unknown" | "inactive" | "invalid_scope" };

export type CategoryAuthorization =
  | { status: "ok"; categories: ResultCategory[] | "all" }
  | { status: "none" }
  | { status: "forbidden" }
  | { status: "misconfigured" };

export function normalizeRoleCode(role: string): string {
  return role.trim().toLowerCase();
}

export function categoriesForResultScope(scope: string): ResultCategory[] | "all" | null {
  if (!KNOWN_RESULT_SCOPES.has(scope)) return null;
  return RESULT_SCOPE_CATEGORIES[scope as DepartmentResultScope];
}

export function lookupDepartments(rows: readonly Department[]): DepartmentLookup {
  const map = new Map(rows.map((row) => [row.code.trim().toLowerCase(), row]));
  return async (code: string) => map.get(normalizeRoleCode(code));
}

const defaultLookup: DepartmentLookup = (code) => departmentsRepo.findDepartmentByCode(code);

/**
 * Resolve the authenticated role to a department.
 * The only input is the server-side role. Callers must not pass a client department id or code.
 */
export async function resolveStaffDepartment(
  role: string,
  lookup: DepartmentLookup = defaultLookup,
): Promise<StaffDepartmentResolution> {
  const code = normalizeRoleCode(role);
  if (!code) return { ok: false, reason: "unknown" };
  if (code === GLOBAL_ADMIN_ROLE) return { ok: true, kind: "global" };
  if (NON_DEPARTMENT_ROLES.has(code)) {
    return { ok: true, kind: "not_department", role: code as "physician" | "patient" };
  }

  const row = await lookup(code);
  if (!row) return { ok: false, reason: "unknown" };
  if (!row.isActive) return { ok: false, reason: "inactive" };
  const categories = categoriesForResultScope(row.resultScope);
  if (categories === null) return { ok: false, reason: "invalid_scope" };

  return {
    ok: true,
    kind: "department",
    department: {
      id: row.id,
      code: row.code,
      name: row.name,
      resultScope: row.resultScope,
      isActive: true,
    },
  };
}

/**
 * Category scope for staff result authorization.
 * super_admin is global. physician is unrestricted by category (assignment rules apply elsewhere).
 * patient has no staff category scope. Department roles use departments.result_scope.
 */
export async function resolveResultCategoryScope(
  role: string,
  lookup?: DepartmentLookup,
): Promise<CategoryAuthorization> {
  const resolved = await resolveStaffDepartment(role, lookup);
  if (!resolved.ok) {
    if (resolved.reason === "invalid_scope") return { status: "misconfigured" };
    return { status: "forbidden" };
  }
  if (resolved.kind === "global") return { status: "ok", categories: "all" };
  if (resolved.kind === "not_department") {
    if (resolved.role === "physician") return { status: "ok", categories: "all" };
    return { status: "none" };
  }
  const categories = categoriesForResultScope(resolved.department.resultScope);
  if (categories === null) return { status: "misconfigured" };
  return { status: "ok", categories };
}

export function scopeFailure(
  scope: CategoryAuthorization,
): { status: 403 | 500; error: string } | null {
  if (scope.status === "ok") return null;
  if (scope.status === "misconfigured") {
    return { status: 500, error: "Unable to authorize this request." };
  }
  return { status: 403, error: "Forbidden" };
}

/**
 * A client category may narrow the server scope. It must not replace or widen it.
 */
export function requestedCategoryWithinScope(
  requested: string | undefined,
  allowed: ResultCategory[] | "all" | "none",
): { denied: boolean; category?: ResultCategory } {
  if (!requested) return { denied: false };
  if (allowed === "none") return { denied: true };
  if (allowed === "all") {
    if (!ALL_RESULT_CATEGORIES.includes(requested as ResultCategory)) return { denied: true };
    return { denied: false, category: requested as ResultCategory };
  }
  if (!allowed.includes(requested as ResultCategory)) return { denied: true };
  return { denied: false, category: requested as ResultCategory };
}

/**
 * Server-owned upload category for department-scoped staff.
 * Department roles ignore client-supplied category (Laboratory cannot upload as Radiology).
 * Global/"all" scope roles (Medical Records, Super Admin) must supply a valid category
 * when Admin has granted the upload_results permission (checked by the upload route).
 */
export async function resolveServerUploadCategory(
  role: string,
  requestedCategory?: string,
  lookup?: DepartmentLookup,
): Promise<
  | { ok: true; category: ResultCategory }
  | { ok: false; status: 400 | 403 | 500; error: string }
> {
  const code = normalizeRoleCode(role);
  if (!code || code === "physician" || code === "patient") {
    return { ok: false, status: 403, error: "Not authorized to upload results" };
  }
  const scope = await resolveResultCategoryScope(role, lookup);
  if (scope.status === "misconfigured") {
    return { ok: false, status: 500, error: "Unable to authorize this request." };
  }
  if (scope.status !== "ok") {
    return { ok: false, status: 403, error: "Not authorized to upload results" };
  }
  if (scope.categories === "all") {
    const requested = typeof requestedCategory === "string" ? requestedCategory.trim() : "";
    if (!requested || !ALL_RESULT_CATEGORIES.includes(requested as ResultCategory)) {
      return {
        ok: false,
        status: 400,
        error: "Category is required when uploading with a global results account.",
      };
    }
    return { ok: true, category: requested as ResultCategory };
  }
  if (scope.categories.length === 0) {
    return { ok: false, status: 403, error: "Not authorized to upload results" };
  }
  if (scope.categories.length === 1) {
    return { ok: true, category: scope.categories[0] };
  }
  // Radiology and similar multi-modality scopes use the department's primary category.
  const primary = scope.categories.includes("radiology")
    ? "radiology"
    : scope.categories.includes("other")
      ? "other"
      : scope.categories[0];
  return { ok: true, category: primary };
}
