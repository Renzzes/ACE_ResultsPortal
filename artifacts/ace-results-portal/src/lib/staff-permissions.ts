import { useEffect, useState } from "react";

/** Frontend mirrors of API category/RBAC helpers. Server remains authoritative. */

export const ALL_RESULT_CATEGORIES = [
  "laboratory",
  "radiology",
  "ultrasound",
  "ct_scan",
  "mri",
  "ecg",
  "echo_2d",
  "rehabilitation",
  "other",
] as const;

export type ResultCategoryCode = (typeof ALL_RESULT_CATEGORIES)[number];

const LAB: ResultCategoryCode[] = ["laboratory"];
const RAD: ResultCategoryCode[] = [
  "radiology",
  "ultrasound",
  "ct_scan",
  "mri",
  "ecg",
  "echo_2d",
  "rehabilitation",
  "other",
];
const OTHER: ResultCategoryCode[] = ["other"];

export function categoriesForStaffRole(role: string | undefined): ResultCategoryCode[] {
  if (!role || role === "physician" || role === "patient") return [];
  if (role === "super_admin" || role === "medical_records") return [...ALL_RESULT_CATEGORIES];
  if (role === "laboratory") return [...LAB];
  if (role === "radiology") return [...RAD];
  if (role === "endoscopy") return [...OTHER];
  return [...OTHER];
}

export function canCreatePatientsUi(role: string | undefined): boolean {
  return Boolean(role && role !== "physician" && role !== "patient");
}

export function canEditPatientsUi(role: string | undefined): boolean {
  return role === "super_admin" || role === "medical_records";
}

export function canAssignPhysiciansUi(role: string | undefined): boolean {
  return role === "super_admin" || role === "medical_records";
}

export function canRegenerateAccessCodeUi(role: string | undefined): boolean {
  return Boolean(role && role !== "physician" && role !== "patient");
}

/**
 * Coarse staff results permission (release/archive/assignment UI).
 * Mirrors API `results` permission for non-physician staff.
 */
export function canUploadResultsUi(role: string | undefined): boolean {
  return Boolean(role && role !== "physician" && role !== "patient");
}

/**
 * File upload entry points. Prefer server-provided `user.permissions.uploadResults`
 * (Admin Roles → Upload Results). Falls back to role defaults matching RBAC seeds.
 */
export function canUploadResultFileUi(
  role: string | undefined,
  permissions?: { uploadResults?: boolean } | null,
): boolean {
  if (permissions && typeof permissions.uploadResults === "boolean") {
    return permissions.uploadResults;
  }
  if (!canUploadResultsUi(role)) return false;
  // Default seed: Medical Records and department clinical roles may upload; physician may not.
  return true;
}

/** Global/"all" scope accounts must choose a category; department roles do not. */
export function staffNeedsUploadCategoryUi(role: string | undefined): boolean {
  return role === "super_admin" || role === "medical_records";
}

export function canReleaseResultsUi(role: string | undefined): boolean {
  return canUploadResultsUi(role);
}

export function canArchiveResultsUi(role: string | undefined): boolean {
  return canUploadResultsUi(role);
}

export function canDeleteResultsUi(role: string | undefined): boolean {
  return role === "super_admin" || role === "medical_records";
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
