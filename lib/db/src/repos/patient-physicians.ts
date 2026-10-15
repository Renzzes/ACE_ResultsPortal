import type { Transaction } from "mssql";
import type { PatientPhysician } from "../types";
import { mapPatientPhysician } from "../mappers";
import { getPool, request, sql } from "../pool";

export async function listAssignedPatientIds(physicianId: number): Promise<number[]> {
  await getPool();
  const result = await request()
    .input("physicianId", sql.Int, physicianId)
    .query("SELECT patient_id FROM dbo.patient_physicians WHERE physician_id = @physicianId");
  return (result.recordset as Array<{ patient_id: number }>).map((row) => Number(row.patient_id));
}

export async function findAssignment(
  patientId: number,
  physicianId: number,
): Promise<PatientPhysician | undefined> {
  await getPool();
  const result = await request()
    .input("patientId", sql.Int, patientId)
    .input("physicianId", sql.Int, physicianId)
    .query(
      "SELECT id, patient_id, physician_id, assigned_at, assigned_by_id FROM dbo.patient_physicians WHERE patient_id = @patientId AND physician_id = @physicianId",
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPatientPhysician(row) : undefined;
}

export async function insertAssignment(
  input: { patientId: number; physicianId: number; assignedById: number },
  tx?: Transaction,
): Promise<void> {
  if (!tx) await getPool();
  await request(tx)
    .input("patientId", sql.Int, input.patientId)
    .input("physicianId", sql.Int, input.physicianId)
    .input("assignedById", sql.Int, input.assignedById)
    .query(
      `INSERT INTO dbo.patient_physicians (patient_id, physician_id, assigned_by_id)
       VALUES (@patientId, @physicianId, @assignedById)`,
    );
}

export async function deleteAssignment(
  patientId: number,
  physicianId: number,
  tx?: Transaction,
): Promise<void> {
  if (!tx) await getPool();
  await request(tx)
    .input("patientId", sql.Int, patientId)
    .input("physicianId", sql.Int, physicianId)
    .query(
      "DELETE FROM dbo.patient_physicians WHERE patient_id = @patientId AND physician_id = @physicianId",
    );
}

export async function deleteAssignmentsForPatient(patientId: number, tx?: Transaction): Promise<void> {
  if (!tx) await getPool();
  await request(tx)
    .input("patientId", sql.Int, patientId)
    .query("DELETE FROM dbo.patient_physicians WHERE patient_id = @patientId");
}
