import { getPool, request, sql } from "../pool";

export type DepartmentResultScope = "all" | "laboratory" | "radiology" | "other";

export type Department = {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  resultScope: DepartmentResultScope;
  createdAt: Date;
  updatedAt: Date;
};

function mapDepartment(row: Record<string, unknown>): Department {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
    resultScope: String(row.result_scope ?? "other") as DepartmentResultScope,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

export function slugifyDepartmentCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export async function tableExists(): Promise<boolean> {
  try {
    await getPool();
    const result = await request().query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.departments', N'U') IS NULL THEN 0 ELSE 1 END AS present
    `);
    return Number((result.recordset[0] as { present: number }).present) === 1;
  } catch {
    return false;
  }
}

export async function listDepartments(opts?: {
  activeOnly?: boolean;
}): Promise<Department[]> {
  if (!(await tableExists())) return [];
  await getPool();
  const activeOnly = Boolean(opts?.activeOnly);
  const result = await request().query(`
    SELECT id, code, name, is_active, sort_order, result_scope, created_at, updated_at
    FROM dbo.departments
    ${activeOnly ? "WHERE is_active = 1" : ""}
    ORDER BY sort_order ASC, name ASC
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapDepartment);
}

export async function findDepartmentByCode(code: string): Promise<Department | undefined> {
  if (!(await tableExists())) return undefined;
  await getPool();
  const result = await request()
    .input("code", sql.NVarChar(32), code)
    .query(`
      SELECT id, code, name, is_active, sort_order, result_scope, created_at, updated_at
      FROM dbo.departments
      WHERE code = @code
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapDepartment(row) : undefined;
}

export async function findDepartmentById(id: number): Promise<Department | undefined> {
  if (!(await tableExists())) return undefined;
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .query(`
      SELECT id, code, name, is_active, sort_order, result_scope, created_at, updated_at
      FROM dbo.departments
      WHERE id = @id
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapDepartment(row) : undefined;
}

export async function insertDepartment(input: {
  code: string;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
  resultScope?: DepartmentResultScope;
}): Promise<Department> {
  await getPool();
  const code = slugifyDepartmentCode(input.code || input.name);
  if (code.length < 2) {
    throw new Error("Department code must be at least 2 characters.");
  }
  const reserved = new Set(["super_admin", "physician", "patient", "staff", "admin", "doctor"]);
  if (reserved.has(code)) {
    throw new Error(`Code "${code}" is reserved.`);
  }

  const result = await request()
    .input("code", sql.NVarChar(32), code)
    .input("name", sql.NVarChar(100), input.name.trim())
    .input("isActive", sql.Bit, input.isActive === false ? 0 : 1)
    .input("sortOrder", sql.Int, input.sortOrder ?? 100)
    .input("resultScope", sql.NVarChar(32), input.resultScope ?? "other")
    .query(`
      INSERT INTO dbo.departments (code, name, is_active, sort_order, result_scope)
      OUTPUT INSERTED.id, INSERTED.code, INSERTED.name, INSERTED.is_active, INSERTED.sort_order,
             INSERTED.result_scope, INSERTED.created_at, INSERTED.updated_at
      VALUES (@code, @name, @isActive, @sortOrder, @resultScope)
    `);
  return mapDepartment(result.recordset[0] as Record<string, unknown>);
}

export async function updateDepartment(
  id: number,
  patch: {
    name?: string;
    isActive?: boolean;
    sortOrder?: number;
    resultScope?: DepartmentResultScope;
  },
): Promise<Department | undefined> {
  const existing = await findDepartmentById(id);
  if (!existing) return undefined;
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .input("name", sql.NVarChar(100), patch.name?.trim() ?? existing.name)
    .input("isActive", sql.Bit, patch.isActive === undefined ? (existing.isActive ? 1 : 0) : patch.isActive ? 1 : 0)
    .input("sortOrder", sql.Int, patch.sortOrder ?? existing.sortOrder)
    .input("resultScope", sql.NVarChar(32), patch.resultScope ?? existing.resultScope)
    .query(`
      UPDATE dbo.departments
      SET name = @name,
          is_active = @isActive,
          sort_order = @sortOrder,
          result_scope = @resultScope,
          updated_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.id, INSERTED.code, INSERTED.name, INSERTED.is_active, INSERTED.sort_order,
             INSERTED.result_scope, INSERTED.created_at, INSERTED.updated_at
      WHERE id = @id
    `);
  return mapDepartment(result.recordset[0] as Record<string, unknown>);
}
