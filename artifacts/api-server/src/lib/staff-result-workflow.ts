import { canUploadCategory, canUploadResults } from "./rbac";
import {
  assertStaffMayAccessPatient,
  type PatientDepartmentStore,
} from "./patient-department-access";
import type { DepartmentLookup } from "./department-resolver";

export type PhysicianSelection =
  | { kind: "omit" }
  | { kind: "set"; ids: number[] };

export type PhysicianSelectionResult =
  | { ok: true; selection: PhysicianSelection }
  | { ok: false; error: string };

function dedupeIds(ids: number[]): number[] {
  return [...new Set(ids)];
}

function collectIds(value: unknown): { ok: true; ids: number[] } | { ok: false; error: string } {
  if (Array.isArray(value)) {
    const ids: number[] = [];
    for (const item of value) {
      const nested = collectIds(item);
      if (!nested.ok) return nested;
      ids.push(...nested.ids);
    }
    return { ok: true, ids: dedupeIds(ids) };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { ok: true, ids: [] };
    if (trimmed.startsWith("[")) {
      try {
        return collectIds(JSON.parse(trimmed) as unknown);
      } catch {
        return { ok: false, error: "Invalid physicianIds" };
      }
    }
    if (trimmed.includes(",")) return collectIds(trimmed.split(","));
  }
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, error: "Invalid physicianId" };
  }
  return { ok: true, ids: [parsed] };
}

/** Upload: physicianIds wins; a single physicianId remains the one-physician form. Neither means no assignment. */
export function parseUploadPhysicianSelection(body: {
  physicianIds?: unknown;
  physicianId?: unknown;
  assignedPhysicianId?: unknown;
}): PhysicianSelectionResult {
  if (body.physicianIds !== undefined) {
    const parsed = collectIds(body.physicianIds);
    if (!parsed.ok) return parsed;
    return { ok: true, selection: { kind: "set", ids: parsed.ids } };
  }
  const single = body.physicianId ?? body.assignedPhysicianId;
  if (single === undefined || single === null || single === "") {
    return { ok: true, selection: { kind: "omit" } };
  }
  const parsed = collectIds(single);
  if (!parsed.ok) return parsed;
  return { ok: true, selection: { kind: "set", ids: parsed.ids } };
}

/**
 * Assignment update.
 * physicianIds, including [], is the selected set.
 * physicianId alone remains the previous one-physician contract (null clears).
 * Neither field leaves existing rows unchanged.
 */
export function parseAssignmentPhysicianSelection(body: {
  physicianIds?: unknown;
  physicianId?: unknown;
}): PhysicianSelectionResult {
  if (Object.prototype.hasOwnProperty.call(body, "physicianIds")) {
    if (body.physicianIds == null) return { ok: false, error: "Invalid physicianIds" };
    const parsed = collectIds(body.physicianIds);
    if (!parsed.ok) return parsed;
    return { ok: true, selection: { kind: "set", ids: parsed.ids } };
  }
  if (Object.prototype.hasOwnProperty.call(body, "physicianId")) {
    if (body.physicianId === null || body.physicianId === "") {
      return { ok: true, selection: { kind: "set", ids: [] } };
    }
    const parsed = collectIds(body.physicianId);
    if (!parsed.ok) return parsed;
    return { ok: true, selection: { kind: "set", ids: parsed.ids } };
  }
  return { ok: true, selection: { kind: "omit" } };
}

export function reconcilePhysicianIds(existing: readonly number[], selected: readonly number[]): {
  preserved: number[];
  inserted: number[];
  removed: number[];
  finalIds: number[];
} {
  const existingUnique = dedupeIds(existing.filter((id) => id > 0));
  const selectedUnique = dedupeIds(selected.filter((id) => id > 0));
  const selectedSet = new Set(selectedUnique);
  const existingSet = new Set(existingUnique);
  return {
    preserved: existingUnique.filter((id) => selectedSet.has(id)),
    inserted: selectedUnique.filter((id) => !existingSet.has(id)),
    removed: existingUnique.filter((id) => !selectedSet.has(id)),
    finalIds: selectedUnique,
  };
}

export function isVisibleOnStaffActiveList(status: string, requestedStatus?: string | null): boolean {
  if (requestedStatus) return status === requestedStatus;
  return status !== "archived";
}

export function statusAfterRestore(): "pending" {
  return "pending";
}

export async function evaluateStaffUploadAccess(
  role: string,
  patientId: number,
  category: string,
  lookup?: DepartmentLookup,
  store?: PatientDepartmentStore,
): Promise<{ ok: true } | { ok: false; status: 403 | 500 | 503; error: string }> {
  if (!canUploadResults(role)) {
    return { ok: false, status: 403, error: "Not authorized to upload results" };
  }
  const membership = await assertStaffMayAccessPatient(role, patientId, lookup, store);
  if (!membership.ok) return membership;
  const categoryAllowed = await canUploadCategory(role, category, lookup);
  if (!categoryAllowed) {
    return { ok: false, status: 403, error: "You don't have permission to perform this action." };
  }
  return { ok: true };
}
