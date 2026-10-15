import type { Department } from "@workspace/db";
import { lookupDepartments, type DepartmentLookup } from "../../artifacts/api-server/src/lib/department-resolver";

const now = new Date("2026-01-01T00:00:00.000Z");

export function departmentRow(
  partial: Pick<Department, "id" | "code" | "name" | "resultScope"> & Partial<Department>,
): Department {
  return {
    isActive: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Mirrors the live ACE_ResultsPortal department rows used by result-scope authorization. */
export function standardDepartments(): Department[] {
  return [
    departmentRow({
      id: 3,
      code: "medical_records",
      name: "Medical Records",
      resultScope: "all",
      sortOrder: 10,
    }),
    departmentRow({
      id: 2,
      code: "laboratory",
      name: "Laboratory",
      resultScope: "laboratory",
      sortOrder: 20,
    }),
    departmentRow({
      id: 4,
      code: "radiology",
      name: "Radiology",
      resultScope: "radiology",
      sortOrder: 30,
    }),
    departmentRow({
      id: 1,
      code: "endoscopy",
      name: "Endoscopy",
      resultScope: "other",
      sortOrder: 40,
    }),
  ];
}

export function standardDepartmentLookup(): DepartmentLookup {
  return lookupDepartments(standardDepartments());
}
