import type { Transaction } from "mssql";
import type { User, UserRole } from "../types";
import { mapUser } from "../mappers";
import { getPool, request, sql } from "../pool";
import { bindInInts, likeContains } from "../sql-helpers";

const USER_COLUMNS = `
  id, username, password_hash, first_name, last_name, email, role, is_active,
  failed_login_attempts, locked_until, last_login_at,
  must_change_password, password_expires_at, created_at, updated_at
`;

const USER_OUTPUT = `
  INSERTED.id, INSERTED.username, INSERTED.password_hash, INSERTED.first_name, INSERTED.last_name,
  INSERTED.email, INSERTED.role, INSERTED.is_active, INSERTED.failed_login_attempts,
  INSERTED.locked_until, INSERTED.last_login_at, INSERTED.must_change_password,
  INSERTED.password_expires_at, INSERTED.created_at, INSERTED.updated_at
`;

export async function findUserByUsername(username: string, tx?: Transaction): Promise<User | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("username", sql.NVarChar(64), username)
    .query(`SELECT ${USER_COLUMNS} FROM dbo.users WHERE username = @username`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapUser(row) : undefined;
}

export async function findUserByEmail(email: string, tx?: Transaction): Promise<User | undefined> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("email", sql.NVarChar(255), email)
    .query(`SELECT ${USER_COLUMNS} FROM dbo.users WHERE LOWER(email) = LOWER(@email)`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapUser(row) : undefined;
}

export async function findUserById(id: number): Promise<User | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .query(`SELECT ${USER_COLUMNS} FROM dbo.users WHERE id = @id`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapUser(row) : undefined;
}

/**
 * Active portal accounts matching name, username, role, or department name.
 * Does not apply messaging authorization — callers must filter.
 */
export async function searchActiveUsers(search: string, limit: number): Promise<User[]> {
  await getPool();
  const cap = Math.min(Math.max(limit, 1), 100);
  const present = await request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.departments', N'U') IS NULL THEN 0 ELSE 1 END AS present
  `);
  const departmentsReady = Number((present.recordset[0] as { present: number }).present) === 1;
  const departmentMatch = departmentsReady
    ? `OR EXISTS (
         SELECT 1 FROM dbo.departments d
         WHERE d.code = u.role AND d.name LIKE @search ESCAPE '\\'
       )`
    : "";
  const rows = await request()
    .input("search", sql.NVarChar(200), likeContains(search))
    .input("limit", sql.Int, cap)
    .query(`
      SELECT ${USER_COLUMNS}
      FROM dbo.users u
      WHERE u.is_active = 1
        AND (
          u.username LIKE @search ESCAPE '\\'
          OR u.first_name LIKE @search ESCAPE '\\'
          OR u.last_name LIKE @search ESCAPE '\\'
          OR (u.first_name + N' ' + u.last_name) LIKE @search ESCAPE '\\'
          OR (u.last_name + N' ' + u.first_name) LIKE @search ESCAPE '\\'
          OR (u.last_name + N', ' + u.first_name) LIKE @search ESCAPE '\\'
          OR u.role LIKE @search ESCAPE '\\'
          ${departmentMatch}
        )
      ORDER BY u.last_name, u.first_name, u.id
      OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY
    `);
  return (rows.recordset as Record<string, unknown>[]).map(mapUser);
}

export async function listUsers(filters: {
  role?: string;
  isActive?: boolean;
  search?: string;
  page: number;
  limit: number;
  /** Roles omitted from unscoped employee lists (e.g. Patient Portal identities). */
  excludeRoles?: string[];
}): Promise<{ data: User[]; total: number }> {
  await getPool();
  const req = request();
  const where: string[] = ["1 = 1"];
  if (filters.role) {
    req.input("role", sql.NVarChar(32), filters.role);
    where.push("role = @role");
  }
  const excludeRoles = (filters.excludeRoles ?? []).filter((role) => role.trim().length > 0);
  excludeRoles.forEach((role, index) => {
    const key = `excludeRole${index}`;
    req.input(key, sql.NVarChar(32), role);
    where.push(`role <> @${key}`);
  });
  if (filters.isActive !== undefined) {
    req.input("isActive", sql.Bit, filters.isActive);
    where.push("is_active = @isActive");
  }
  if (filters.search) {
    req.input("search", sql.NVarChar(200), likeContains(filters.search));
    where.push(
      "(username LIKE @search ESCAPE '\\' OR first_name LIKE @search ESCAPE '\\' OR last_name LIKE @search ESCAPE '\\')",
    );
  }
  const whereSql = where.join(" AND ");
  req.input("offset", sql.Int, (filters.page - 1) * filters.limit);
  req.input("limit", sql.Int, filters.limit);

  const count = await req.query(`SELECT COUNT(*) AS total FROM dbo.users WHERE ${whereSql}`);
  const listReq = request();
  if (filters.role) listReq.input("role", sql.NVarChar(32), filters.role);
  excludeRoles.forEach((role, index) => {
    listReq.input(`excludeRole${index}`, sql.NVarChar(32), role);
  });
  if (filters.isActive !== undefined) listReq.input("isActive", sql.Bit, filters.isActive);
  if (filters.search) listReq.input("search", sql.NVarChar(200), likeContains(filters.search));
  listReq.input("offset", sql.Int, (filters.page - 1) * filters.limit);
  listReq.input("limit", sql.Int, filters.limit);

  const rows = await listReq.query(
    `SELECT ${USER_COLUMNS} FROM dbo.users WHERE ${whereSql} ORDER BY created_at OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
  );
  return {
    data: (rows.recordset as Record<string, unknown>[]).map(mapUser),
    total: Number((count.recordset[0] as { total: number }).total ?? 0),
  };
}

export async function insertUser(
  input: {
    username: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    email: string | null;
    role: UserRole;
  },
  tx?: Transaction,
): Promise<User> {
  if (!tx) await getPool();
  const result = await request(tx)
    .input("username", sql.NVarChar(64), input.username)
    .input("passwordHash", sql.NVarChar(255), input.passwordHash)
    .input("firstName", sql.NVarChar(100), input.firstName)
    .input("lastName", sql.NVarChar(100), input.lastName)
    .input("email", sql.NVarChar(255), input.email)
    .input("role", sql.NVarChar(32), input.role)
    .query(
      `INSERT INTO dbo.users (username, password_hash, first_name, last_name, email, role, is_active, failed_login_attempts)
       OUTPUT ${USER_OUTPUT}
       VALUES (@username, @passwordHash, @firstName, @lastName, @email, @role, 1, 0)`,
    );
  return mapUser(result.recordset[0] as Record<string, unknown>);
}

export async function updateUser(
  id: number,
  patch: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    role?: UserRole;
    isActive?: boolean;
  },
): Promise<User | undefined> {
  await getPool();
  const existing = await findUserById(id);
  if (!existing) return undefined;
  const result = await request()
    .input("id", sql.Int, id)
    .input("firstName", sql.NVarChar(100), patch.firstName ?? existing.firstName)
    .input("lastName", sql.NVarChar(100), patch.lastName ?? existing.lastName)
    .input("email", sql.NVarChar(255), patch.email !== undefined ? patch.email : existing.email)
    .input("role", sql.NVarChar(32), patch.role ?? existing.role)
    .input("isActive", sql.Bit, patch.isActive !== undefined ? patch.isActive : existing.isActive)
    .query(
      `UPDATE dbo.users
       SET first_name = @firstName, last_name = @lastName, email = @email, role = @role,
           is_active = @isActive, updated_at = SYSDATETIMEOFFSET()
       OUTPUT ${USER_OUTPUT}
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapUser(row) : undefined;
}

export async function setUserPassword(
  id: number,
  passwordHash: string,
  resetLockout: boolean,
  options?: {
    mustChangePassword?: boolean;
    passwordExpiresAt?: Date | null;
    clearForcedChange?: boolean;
  },
  tx?: Transaction,
): Promise<User | undefined> {
  if (!tx) await getPool();
  const mustChange =
    options?.clearForcedChange === true
      ? false
      : options?.mustChangePassword === true
        ? true
        : undefined;
  const expiresAt =
    options?.clearForcedChange === true
      ? null
      : options && "passwordExpiresAt" in options
        ? options.passwordExpiresAt ?? null
        : undefined;

  const forcedSql =
    mustChange === undefined && expiresAt === undefined
      ? ""
      : `, must_change_password = ${mustChange === undefined ? "must_change_password" : "@mustChange"}, password_expires_at = ${expiresAt === undefined ? "password_expires_at" : "@passwordExpiresAt"}`;

  const req = request(tx)
    .input("id", sql.Int, id)
    .input("passwordHash", sql.NVarChar(255), passwordHash);
  if (mustChange !== undefined) req.input("mustChange", sql.Bit, mustChange);
  if (expiresAt !== undefined) req.input("passwordExpiresAt", sql.DateTimeOffset, expiresAt);

  const result = await req.query(
    resetLockout
      ? `UPDATE dbo.users
         SET password_hash = @passwordHash, failed_login_attempts = 0, locked_until = NULL${forcedSql}, updated_at = SYSDATETIMEOFFSET()
         OUTPUT ${USER_OUTPUT}
         WHERE id = @id`
      : `UPDATE dbo.users
         SET password_hash = @passwordHash${forcedSql}, updated_at = SYSDATETIMEOFFSET()
         OUTPUT ${USER_OUTPUT}
         WHERE id = @id`,
  );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapUser(row) : undefined;
}

export async function clearMustChangePassword(id: number): Promise<User | undefined> {
  await getPool();
  const result = await request()
    .input("id", sql.Int, id)
    .query(
      `UPDATE dbo.users
       SET must_change_password = 0, password_expires_at = NULL, updated_at = SYSDATETIMEOFFSET()
       OUTPUT ${USER_OUTPUT}
       WHERE id = @id`,
    );
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapUser(row) : undefined;
}

export async function recordFailedLogin(
  id: number,
  attempts: number,
  lockedUntil: Date | null,
): Promise<void> {
  await getPool();
  await request()
    .input("id", sql.Int, id)
    .input("attempts", sql.Int, attempts)
    .input("lockedUntil", sql.DateTimeOffset, lockedUntil)
    .query(
      `UPDATE dbo.users
       SET failed_login_attempts = @attempts, locked_until = @lockedUntil, updated_at = SYSDATETIMEOFFSET()
       WHERE id = @id`,
    );
}

export async function recordSuccessfulLogin(id: number): Promise<void> {
  await getPool();
  await request()
    .input("id", sql.Int, id)
    .query(
      `UPDATE dbo.users
       SET failed_login_attempts = 0, locked_until = NULL, last_login_at = SYSDATETIMEOFFSET(), updated_at = SYSDATETIMEOFFSET()
       WHERE id = @id`,
    );
}

export async function listActivePhysicians(search: string): Promise<
  Array<{ id: number; firstName: string; lastName: string; username: string }>
> {
  await getPool();
  const req = request();
  req.input("role", sql.NVarChar(32), "physician");
  let where =
    "role = @role AND is_active = 1";
  if (search) {
    req.input("search", sql.NVarChar(200), likeContains(search));
    where +=
      " AND (last_name LIKE @search ESCAPE '\\' OR first_name LIKE @search ESCAPE '\\' OR username LIKE @search ESCAPE '\\')";
  }
  const result = await req.query(
    `SELECT id, first_name, last_name, username FROM dbo.users WHERE ${where} ORDER BY last_name, first_name`,
  );
  return (result.recordset as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    username: String(row.username),
  }));
}

export async function countUsersByRole(): Promise<{ totalStaff: number; totalPhysicians: number }> {
  await getPool();
  const result = await request().query(`
    SELECT
      SUM(CASE WHEN role <> N'physician' AND role <> N'patient' THEN 1 ELSE 0 END) AS totalStaff,
      SUM(CASE WHEN role = N'physician' THEN 1 ELSE 0 END) AS totalPhysicians
    FROM dbo.users
  `);
  const row = result.recordset[0] as { totalStaff: number; totalPhysicians: number };
  return {
    totalStaff: Number(row.totalStaff ?? 0),
    totalPhysicians: Number(row.totalPhysicians ?? 0),
  };
}

export async function findUsersByIds(ids: number[]): Promise<User[]> {
  if (ids.length === 0) return [];
  await getPool();
  const req = request();
  const list = bindInInts(req, "uid", ids);
  const result = await req.query(`SELECT ${USER_COLUMNS} FROM dbo.users WHERE id IN (${list})`);
  return (result.recordset as Record<string, unknown>[]).map(mapUser);
}

export async function findUserByIdTx(tx: Transaction, id: number): Promise<User | undefined> {
  const result = await request(tx)
    .input("id", sql.Int, id)
    .query(`SELECT ${USER_COLUMNS} FROM dbo.users WHERE id = @id`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapUser(row) : undefined;
}
