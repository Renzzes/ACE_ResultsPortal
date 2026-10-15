import {
  patientPhysiciansRepo,
  patientsRepo,
  usersRepo,
} from "@workspace/db";
import type { AuthUser } from "../middlewares/auth";

export type PhysicianPatientAccessDeps = {
  findPatientById: (id: number) => Promise<{ id: number } | undefined>;
  findAssignment: (
    patientId: number,
    physicianId: number,
  ) => Promise<{ id: number } | undefined | null>;
  findUserById: (
    id: number,
  ) => Promise<{ id: number; role: string; isActive: boolean } | undefined>;
};

const defaultDeps: PhysicianPatientAccessDeps = {
  findPatientById: patientsRepo.findPatientById,
  findAssignment: patientPhysiciansRepo.findAssignment,
  findUserById: usersRepo.findUserById,
};

/**
 * Physician may act on a patient only when:
 * authenticated + live role=physician + active + patient_physicians assignment.
 */
export async function assertPhysicianMayAccessPatient(
  user: AuthUser,
  patientId: number,
  deps: PhysicianPatientAccessDeps = defaultDeps,
): Promise<
  | { ok: true }
  | { ok: false; reason: "forbidden" | "not_found" }
> {
  const actor = await deps.findUserById(user.userId);
  if (!actor || !actor.isActive || actor.role !== "physician") {
    return { ok: false, reason: "forbidden" };
  }
  if (user.role !== "physician") {
    return { ok: false, reason: "forbidden" };
  }
  const patient = await deps.findPatientById(patientId);
  if (!patient) {
    return { ok: false, reason: "not_found" };
  }
  const assignment = await deps.findAssignment(patientId, user.userId);
  if (!assignment) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true };
}

export function trimNullable(value: unknown, max: number): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function trimRequired(value: unknown, max: number): string | null {
  const trimmed = trimNullable(value, max);
  return trimmed;
}

export const MAX_PRESCRIPTION_ITEMS = 20;

export type ParsedPrescriptionItem = {
  medicineName: string;
  genericName: string | null;
  dosage: string;
  dosageUnit: string | null;
  route: string | null;
  frequency: string;
  duration: string | null;
  quantity: string | null;
  instructions: string | null;
};

/**
 * Validate / normalize prescription create items (API + tests).
 * Does not authorize; does not touch the database.
 */
export function parsePrescriptionCreateItems(
  rawItems: unknown,
):
  | { ok: true; items: ParsedPrescriptionItem[] }
  | { ok: false; error: string } {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: "At least one medication item is required." };
  }
  if (rawItems.length > MAX_PRESCRIPTION_ITEMS) {
    return {
      ok: false,
      error: `A prescription may include at most ${MAX_PRESCRIPTION_ITEMS} medicines.`,
    };
  }

  const items: ParsedPrescriptionItem[] = [];
  for (const raw of rawItems as Array<Record<string, unknown>>) {
    const medicineName = trimRequired(raw?.medicineName ?? raw?.medicine_name, 255);
    if (!medicineName) {
      return { ok: false, error: "Each medication item requires medicineName." };
    }
    const dosage = trimRequired(raw?.dosage, 100);
    if (!dosage) {
      return { ok: false, error: "Each medication item requires dosage." };
    }
    const frequency = trimRequired(raw?.frequency, 100);
    if (!frequency) {
      return { ok: false, error: "Each medication item requires frequency." };
    }
    items.push({
      medicineName,
      genericName: trimNullable(raw?.genericName ?? raw?.generic_name, 255),
      dosage,
      dosageUnit: trimNullable(raw?.dosageUnit ?? raw?.dosage_unit, 50),
      route: trimNullable(raw?.route, 50),
      frequency,
      duration: trimNullable(raw?.duration, 100),
      quantity: trimNullable(raw?.quantity, 100),
      instructions: trimNullable(raw?.instructions, 500),
    });
  }
  return { ok: true, items };
}

/** Portal medication ownership: JWT patientId must match prescription.patient_id. */
export function portalOwnsPrescription(
  jwtPatientId: number,
  prescription: { patientId: number } | null | undefined,
): boolean {
  if (!prescription) return false;
  return prescription.patientId === jwtPatientId;
}
