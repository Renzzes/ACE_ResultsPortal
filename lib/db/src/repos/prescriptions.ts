import type { Transaction } from "mssql";
import type {
  PrescriptionItemRow,
  PrescriptionRow,
  PrescriptionStatus,
  PrescriptionWithItems,
} from "../types";
import { getPool, request, sql } from "../pool";
import { bindInInts } from "../sql-helpers";

const PRESCRIPTION_COLUMNS = `
  id, patient_id, physician_id, status, diagnosis_or_indication, general_instructions,
  notes, created_at, updated_at
`;

const ITEM_COLUMNS = `
  id, prescription_id, medicine_name, generic_name, dosage, dosage_unit, route,
  frequency, duration, quantity, instructions, created_at, updated_at
`;

function mapPrescription(row: Record<string, unknown>): PrescriptionRow {
  return {
    id: Number(row.id),
    patientId: Number(row.patient_id),
    physicianId: Number(row.physician_id),
    status: String(row.status) as PrescriptionStatus,
    diagnosisOrIndication: row.diagnosis_or_indication == null ? null : String(row.diagnosis_or_indication),
    generalInstructions: row.general_instructions == null ? null : String(row.general_instructions),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapItem(row: Record<string, unknown>): PrescriptionItemRow {
  return {
    id: Number(row.id),
    prescriptionId: Number(row.prescription_id),
    medicineName: String(row.medicine_name),
    genericName: row.generic_name == null ? null : String(row.generic_name),
    dosage: row.dosage == null ? null : String(row.dosage),
    dosageUnit: row.dosage_unit == null ? null : String(row.dosage_unit),
    route: row.route == null ? null : String(row.route),
    frequency: row.frequency == null ? null : String(row.frequency),
    duration: row.duration == null ? null : String(row.duration),
    quantity: row.quantity == null ? null : String(row.quantity),
    instructions: row.instructions == null ? null : String(row.instructions),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export async function schemaReady(): Promise<boolean> {
  try {
    await getPool();
    const result = await request().query(`
      SELECT
        OBJECT_ID(N'dbo.prescriptions', N'U') AS prescriptions_oid,
        OBJECT_ID(N'dbo.prescription_items', N'U') AS items_oid
    `);
    const row = result.recordset[0] as {
      prescriptions_oid?: number | null;
      items_oid?: number | null;
    };
    return Boolean(row?.prescriptions_oid && row?.items_oid);
  } catch {
    return false;
  }
}

export type CreatePrescriptionItemInput = {
  medicineName: string;
  genericName?: string | null;
  dosage?: string | null;
  dosageUnit?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  quantity?: string | null;
  instructions?: string | null;
};

export type CreatePrescriptionInput = {
  patientId: number;
  physicianId: number;
  diagnosisOrIndication?: string | null;
  generalInstructions?: string | null;
  notes?: string | null;
  items: CreatePrescriptionItemInput[];
};

async function listItemsForPrescriptionIds(
  prescriptionIds: number[],
  tx?: Transaction,
): Promise<Map<number, PrescriptionItemRow[]>> {
  const map = new Map<number, PrescriptionItemRow[]>();
  if (prescriptionIds.length === 0) return map;
  if (!tx) await getPool();
  const req = request(tx);
  const inList = bindInInts(req, "pid", prescriptionIds);
  const result = await req.query(`
    SELECT ${ITEM_COLUMNS}
    FROM dbo.prescription_items
    WHERE prescription_id IN (${inList})
    ORDER BY id ASC
  `);
  for (const raw of result.recordset as Record<string, unknown>[]) {
    const item = mapItem(raw);
    const list = map.get(item.prescriptionId) ?? [];
    list.push(item);
    map.set(item.prescriptionId, list);
  }
  return map;
}

async function attachItemsAndPhysicianNames(
  rows: PrescriptionRow[],
  tx?: Transaction,
): Promise<PrescriptionWithItems[]> {
  if (rows.length === 0) return [];
  const itemMap = await listItemsForPrescriptionIds(
    rows.map((r) => r.id),
    tx,
  );
  const physicianIds = [...new Set(rows.map((r) => r.physicianId))];
  const nameMap = new Map<number, string>();
  if (physicianIds.length > 0) {
    if (!tx) await getPool();
    const req = request(tx);
    const inList = bindInInts(req, "uid", physicianIds);
    const users = await req.query(`
      SELECT id, first_name, last_name FROM dbo.users WHERE id IN (${inList})
    `);
    for (const u of users.recordset as Array<{ id: number; first_name: string; last_name: string }>) {
      nameMap.set(Number(u.id), `Dr. ${u.last_name}, ${u.first_name}`);
    }
  }
  return rows.map((row) => ({
    ...row,
    items: itemMap.get(row.id) ?? [],
    physicianName: nameMap.get(row.physicianId),
  }));
}

export async function listPrescriptionsForPatient(
  patientId: number,
): Promise<PrescriptionWithItems[]> {
  if (!(await schemaReady())) return [];
  await getPool();
  const result = await request()
    .input("patientId", sql.Int, patientId)
    .query(`
      SELECT ${PRESCRIPTION_COLUMNS}
      FROM dbo.prescriptions
      WHERE patient_id = @patientId
      ORDER BY created_at DESC, id DESC
    `);
  const rows = (result.recordset as Record<string, unknown>[]).map(mapPrescription);
  return attachItemsAndPhysicianNames(rows);
}

export async function findPrescriptionByIdForPatient(
  prescriptionId: number,
  patientId: number,
): Promise<PrescriptionWithItems | undefined> {
  if (!(await schemaReady())) return undefined;
  await getPool();
  const result = await request()
    .input("id", sql.Int, prescriptionId)
    .input("patientId", sql.Int, patientId)
    .query(`
      SELECT ${PRESCRIPTION_COLUMNS}
      FROM dbo.prescriptions
      WHERE id = @id AND patient_id = @patientId
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const [withItems] = await attachItemsAndPhysicianNames([mapPrescription(row)]);
  return withItems;
}

export async function createPrescription(
  input: CreatePrescriptionInput,
  tx?: Transaction,
): Promise<PrescriptionWithItems> {
  if (!(await schemaReady())) {
    throw new Error("PRESCRIPTIONS_SCHEMA_MISSING");
  }
  if (!tx) await getPool();

  const header = await request(tx)
    .input("patientId", sql.Int, input.patientId)
    .input("physicianId", sql.Int, input.physicianId)
    .input("diagnosis", sql.NVarChar(500), input.diagnosisOrIndication ?? null)
    .input("general", sql.NVarChar(sql.MAX), input.generalInstructions ?? null)
    .input("notes", sql.NVarChar(sql.MAX), input.notes ?? null)
    .query(`
      INSERT INTO dbo.prescriptions (
        patient_id, physician_id, status, diagnosis_or_indication, general_instructions, notes
      )
      OUTPUT INSERTED.id, INSERTED.patient_id, INSERTED.physician_id, INSERTED.status,
             INSERTED.diagnosis_or_indication, INSERTED.general_instructions, INSERTED.notes,
             INSERTED.created_at, INSERTED.updated_at
      VALUES (
        @patientId, @physicianId, N'active', @diagnosis, @general, @notes
      )
    `);

  const created = mapPrescription(header.recordset[0] as Record<string, unknown>);

  for (const item of input.items) {
    await request(tx)
      .input("prescriptionId", sql.Int, created.id)
      .input("medicineName", sql.NVarChar(255), item.medicineName)
      .input("genericName", sql.NVarChar(255), item.genericName ?? null)
      .input("dosage", sql.NVarChar(100), item.dosage ?? null)
      .input("dosageUnit", sql.NVarChar(50), item.dosageUnit ?? null)
      .input("route", sql.NVarChar(50), item.route ?? null)
      .input("frequency", sql.NVarChar(100), item.frequency ?? null)
      .input("duration", sql.NVarChar(100), item.duration ?? null)
      .input("quantity", sql.NVarChar(100), item.quantity ?? null)
      .input("instructions", sql.NVarChar(500), item.instructions ?? null)
      .query(`
        INSERT INTO dbo.prescription_items (
          prescription_id, medicine_name, generic_name, dosage, dosage_unit, route,
          frequency, duration, quantity, instructions
        )
        VALUES (
          @prescriptionId, @medicineName, @genericName, @dosage, @dosageUnit, @route,
          @frequency, @duration, @quantity, @instructions
        )
      `);
  }

  const [full] = await attachItemsAndPhysicianNames([created], tx);
  return full;
}
