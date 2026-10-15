import type { PrescriptionWithItems } from "@workspace/db";

export function formatPrescription(p: PrescriptionWithItems) {
  return {
    id: p.id,
    patientId: p.patientId,
    physicianId: p.physicianId,
    physicianName: p.physicianName ?? `Physician #${p.physicianId}`,
    status: p.status,
    diagnosisOrIndication: p.diagnosisOrIndication,
    generalInstructions: p.generalInstructions,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    items: p.items.map((item) => ({
      id: item.id,
      medicineName: item.medicineName,
      genericName: item.genericName,
      dosage: item.dosage,
      dosageUnit: item.dosageUnit,
      route: item.route,
      frequency: item.frequency,
      duration: item.duration,
      quantity: item.quantity,
      instructions: item.instructions,
    })),
  };
}
