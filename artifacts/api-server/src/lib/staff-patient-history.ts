/**
 * Staff patient history is the department-scoped patient directory,
 * projected to name, hospital id, and dbo.patients.created_at.
 * A client department id is not an input.
 */
export type StaffHistorySourcePatient = {
  id: number;
  patientHisId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  /** dbo.patients.created_at. Not a membership, result, or portal timestamp. */
  createdAt: Date;
};

export type StaffHistoryRow = {
  id: number;
  name: string;
  patientHisId: string;
  registeredAt: string;
};

export function formatStaffPatientName(patient: Pick<StaffHistorySourcePatient, "lastName" | "firstName" | "middleName">): string {
  const middle = patient.middleName?.trim();
  return middle
    ? `${patient.lastName}, ${patient.firstName} ${middle}`
    : `${patient.lastName}, ${patient.firstName}`;
}

export function staffPatientHistoryRows(input: {
  patients: readonly StaffHistorySourcePatient[];
  allowedIds: readonly number[] | "all";
  search?: string;
}): StaffHistoryRow[] {
  const allowed = input.allowedIds === "all" ? null : new Set(input.allowedIds);
  const search = input.search?.trim().toLowerCase() ?? "";
  const seen = new Set<number>();
  const rows: StaffHistoryRow[] = [];
  for (const patient of input.patients) {
    if (seen.has(patient.id)) continue;
    if (allowed && !allowed.has(patient.id)) continue;
    if (search) {
      const haystack = `${patient.patientHisId} ${patient.lastName} ${patient.firstName} ${patient.middleName ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }
    seen.add(patient.id);
    rows.push({
      id: patient.id,
      name: formatStaffPatientName(patient),
      patientHisId: patient.patientHisId,
      registeredAt: patient.createdAt.toISOString(),
    });
  }
  return rows;
}
