import type { Transaction } from "mssql";
import { getPool, request, sql } from "../pool";

export type ResultPhysicianAssignment = {
  id: number;
  resultId: number;
  physicianId: number;
  assignedById: number | null;
  assignedAt: Date;
};

function mapRow(row: Record<string, unknown>): ResultPhysicianAssignment {
  return {
    id: Number(row.id),
    resultId: Number(row.result_id),
    physicianId: Number(row.physician_id),
    assignedById: row.assigned_by_id == null ? null : Number(row.assigned_by_id),
    assignedAt: new Date(String(row.assigned_at)),
  };
}

export async function schemaReady(): Promise<boolean> {
  try {
    await getPool();
    const result = await request().query(`
      SELECT OBJECT_ID(N'dbo.result_physicians', N'U') AS oid
    `);
    return Boolean((result.recordset[0] as { oid?: number | null } | undefined)?.oid);
  } catch {
    return false;
  }
}

export async function findAssignment(
  resultId: number,
  physicianId: number,
  tx?: Transaction,
): Promise<ResultPhysicianAssignment | undefined> {
  if (!(await schemaReady())) return undefined;
  if (!tx) await getPool();
  const result = await request(tx)
    .input("resultId", sql.Int, resultId)
    .input("physicianId", sql.Int, physicianId)
    .query(`
      SELECT id, result_id, physician_id, assigned_by_id, assigned_at
      FROM dbo.result_physicians
      WHERE result_id = @resultId AND physician_id = @physicianId
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : undefined;
}

export async function hasAssignments(resultId: number, tx?: Transaction): Promise<boolean> {
  if (!(await schemaReady())) return false;
  if (!tx) await getPool();
  const result = await request(tx)
    .input("resultId", sql.Int, resultId)
    .query(`
      SELECT TOP (1) id FROM dbo.result_physicians WHERE result_id = @resultId
    `);
  return result.recordset.length > 0;
}

export async function listPhysicianIdsForResult(
  resultId: number,
  tx?: Transaction,
): Promise<number[]> {
  if (!(await schemaReady())) return [];
  if (!tx) await getPool();
  const result = await request(tx)
    .input("resultId", sql.Int, resultId)
    .query(`
      SELECT physician_id FROM dbo.result_physicians WHERE result_id = @resultId
    `);
  return (result.recordset as Array<{ physician_id: number }>).map((r) => Number(r.physician_id));
}

export async function listResultIdsForPhysician(physicianId: number): Promise<number[]> {
  if (!(await schemaReady())) return [];
  await getPool();
  const result = await request()
    .input("physicianId", sql.Int, physicianId)
    .query(`
      SELECT result_id FROM dbo.result_physicians WHERE physician_id = @physicianId
    `);
  return (result.recordset as Array<{ result_id: number }>).map((r) => Number(r.result_id));
}

export async function listAssignmentsForResult(
  resultId: number,
  tx?: Transaction,
): Promise<ResultPhysicianAssignment[]> {
  if (!(await schemaReady())) return [];
  if (!tx) await getPool();
  const result = await request(tx)
    .input("resultId", sql.Int, resultId)
    .query(`
      SELECT id, result_id, physician_id, assigned_by_id, assigned_at
      FROM dbo.result_physicians
      WHERE result_id = @resultId
      ORDER BY assigned_at
    `);
  return (result.recordset as Record<string, unknown>[]).map(mapRow);
}

/**
 * Make result_physicians match the selected set.
 * Kept pairs are not deleted and reinserted. New pairs are inserted. Unselected pairs are removed.
 */
export async function reconcileAssignments(
  input: {
    resultId: number;
    physicianIds: readonly number[];
    assignedById: number;
  },
  tx?: Transaction,
): Promise<{ previousPhysicianIds: number[]; currentPhysicianIds: number[]; insertedPhysicianIds: number[] }> {
  if (!(await schemaReady())) {
    throw new Error("RESULT_PHYSICIANS_SCHEMA_MISSING");
  }
  if (!tx) await getPool();
  const previous = await listPhysicianIdsForResult(input.resultId, tx);
  const selected = [...new Set(input.physicianIds)];
  const selectedSet = new Set(selected);
  const previousSet = new Set(previous);
  const removed = previous.filter((id) => !selectedSet.has(id));
  const inserted = selected.filter((id) => !previousSet.has(id));

  for (const physicianId of removed) {
    await request(tx)
      .input("resultId", sql.Int, input.resultId)
      .input("physicianId", sql.Int, physicianId)
      .query(`
        DELETE FROM dbo.result_physicians
        WHERE result_id = @resultId AND physician_id = @physicianId
      `);
  }

  for (const physicianId of inserted) {
    await request(tx)
      .input("resultId", sql.Int, input.resultId)
      .input("physicianId", sql.Int, physicianId)
      .input("assignedById", sql.Int, input.assignedById)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.result_physicians
          WHERE result_id = @resultId AND physician_id = @physicianId
        )
        INSERT INTO dbo.result_physicians (result_id, physician_id, assigned_by_id)
        VALUES (@resultId, @physicianId, @assignedById)
      `);
  }

  return {
    previousPhysicianIds: previous,
    currentPhysicianIds: selected,
    insertedPhysicianIds: inserted,
  };
}

/**
 * Replace all reviewing physicians for a result with a single physician (or clear).
 * Returns previous physician IDs for notification/access revocation.
 */
export async function replaceAssignment(
  input: {
    resultId: number;
    physicianId: number | null;
    assignedById: number;
  },
  tx?: Transaction,
): Promise<{ previousPhysicianIds: number[]; currentPhysicianId: number | null }> {
  if (!(await schemaReady())) {
    throw new Error("RESULT_PHYSICIANS_SCHEMA_MISSING");
  }
  if (!tx) await getPool();
  const previous = await listPhysicianIdsForResult(input.resultId, tx);
  await request(tx)
    .input("resultId", sql.Int, input.resultId)
    .query(`DELETE FROM dbo.result_physicians WHERE result_id = @resultId`);

  if (input.physicianId == null) {
    return { previousPhysicianIds: previous, currentPhysicianId: null };
  }

  await request(tx)
    .input("resultId", sql.Int, input.resultId)
    .input("physicianId", sql.Int, input.physicianId)
    .input("assignedById", sql.Int, input.assignedById)
    .query(`
      INSERT INTO dbo.result_physicians (result_id, physician_id, assigned_by_id)
      VALUES (@resultId, @physicianId, @assignedById)
    `);

  return { previousPhysicianIds: previous, currentPhysicianId: input.physicianId };
}

export async function assignPhysician(
  input: {
    resultId: number;
    physicianId: number;
    assignedById: number;
  },
  tx?: Transaction,
): Promise<ResultPhysicianAssignment> {
  const { currentPhysicianId } = await replaceAssignment(
    {
      resultId: input.resultId,
      physicianId: input.physicianId,
      assignedById: input.assignedById,
    },
    tx,
  );
  const row = await findAssignment(input.resultId, currentPhysicianId!, tx);
  if (!row) throw new Error("RESULT_PHYSICIAN_ASSIGNMENT_FAILED");
  return row;
}
