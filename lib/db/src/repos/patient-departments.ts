import type { Transaction } from "mssql";
import { PatientDepartmentSchemaError } from "../errors";
import { getPool, request, sql } from "../pool";

export { PatientDepartmentSchemaError };

export type PatientDepartmentMembership = {
  id: number;
  patientId: number;
  departmentId: number;
  registeredById: number | null;
  registeredAt: Date;
};

function mapRow(row: Record<string, unknown>): PatientDepartmentMembership {
  return {
    id: Number(row.id),
    patientId: Number(row.patient_id),
    departmentId: Number(row.department_id),
    registeredById: row.registered_by_id == null ? null : Number(row.registered_by_id),
    registeredAt: row.registered_at instanceof Date ? row.registered_at : new Date(String(row.registered_at)),
  };
}

export async function tableExists(): Promise<boolean> {
  try {
    await getPool();
    const result = await request().query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.patient_departments', N'U') IS NULL THEN 0 ELSE 1 END AS present
    `);
    return Number((result.recordset[0] as { present: number }).present) === 1;
  } catch {
    return false;
  }
}

async function requireTable(tx?: Transaction): Promise<void> {
  if (tx) return;
  if (!(await tableExists())) throw new PatientDepartmentSchemaError();
}

function isUniqueViolation(err: unknown): boolean {
  const number = (err as { number?: number }).number;
  return number === 2627 || number === 2601;
}

export async function listForPatient(
  patientId: number,
  tx?: Transaction,
): Promise<PatientDepartmentMembership[]> {
  await requireTable(tx);
  if (!tx) await getPool();
  const result = await request(tx)
    .input("patientId", sql.Int, patientId)
    .query(`
      SELECT id, patient_id, department_id, registered_by_id, registered_at
      FROM dbo.patient_departments
      WHERE patient_id = @patientId
      ORDER BY department_id ASC, id ASC
    `);
  return (result.recordset as Record<string, unknown>[]).map(mapRow);
}

export async function listPatientIdsForDepartment(
  departmentId: number,
  tx?: Transaction,
): Promise<number[]> {
  await requireTable(tx);
  if (!tx) await getPool();
  const result = await request(tx)
    .input("departmentId", sql.Int, departmentId)
    .query(`
      SELECT patient_id
      FROM dbo.patient_departments
      WHERE department_id = @departmentId
      ORDER BY patient_id ASC
    `);
  return (result.recordset as Array<{ patient_id: number }>).map((row) => Number(row.patient_id));
}

export async function findMembership(
  patientId: number,
  departmentId: number,
  tx?: Transaction,
): Promise<PatientDepartmentMembership | undefined> {
  await requireTable(tx);
  if (!tx) await getPool();
  const result = await request(tx)
    .input("patientId", sql.Int, patientId)
    .input("departmentId", sql.Int, departmentId)
    .query(`
      SELECT id, patient_id, department_id, registered_by_id, registered_at
      FROM dbo.patient_departments
      WHERE patient_id = @patientId AND department_id = @departmentId
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

/**
 * Insert the membership when the pair is absent.
 * A unique constraint violation from a concurrent insert is treated as already present.
 */
export async function ensureMembership(
  input: { patientId: number; departmentId: number; registeredById: number | null },
  tx?: Transaction,
): Promise<{ membership: PatientDepartmentMembership; created: boolean }> {
  await requireTable(tx);
  if (!tx) await getPool();
  const existing = await findMembership(input.patientId, input.departmentId, tx);
  if (existing) return { membership: existing, created: false };

  try {
    const inserted = await request(tx)
      .input("patientId", sql.Int, input.patientId)
      .input("departmentId", sql.Int, input.departmentId)
      .input("registeredById", sql.Int, input.registeredById)
      .query(`
        INSERT INTO dbo.patient_departments (patient_id, department_id, registered_by_id)
        OUTPUT INSERTED.id, INSERTED.patient_id, INSERTED.department_id,
               INSERTED.registered_by_id, INSERTED.registered_at
        VALUES (@patientId, @departmentId, @registeredById)
      `);
    const row = inserted.recordset[0] as Record<string, unknown>;
    return { membership: mapRow(row), created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await findMembership(input.patientId, input.departmentId, tx);
    if (!raced) throw err;
    return { membership: raced, created: false };
  }
}
