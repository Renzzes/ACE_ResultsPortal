import fs from "node:fs";
import path from "node:path";
import { getPool, request, sql } from "../pool";
import { findRepoRoot } from "../load-env";
import * as departmentsRepo from "./departments";

export const ROLE_PERMISSION_KEYS = [
  "users",
  "patients",
  "results",
  "upload_results",
  "audit",
  "archive",
  "settings",
] as const;

export type RolePermissionKey = (typeof ROLE_PERMISSION_KEYS)[number];

/** Fixed roles always shown in the permissions matrix. */
export const SYSTEM_RBAC_ROLES = ["super_admin", "physician"] as const;

/** @deprecated Prefer listRbacRoles(); kept for callers that need a sync fallback. */
export const RBAC_ROLES = [
  "super_admin",
  "medical_records",
  "laboratory",
  "radiology",
  "endoscopy",
  "physician",
] as const;

export type RbacRole = string;

export type RolePermissionRow = {
  role: string;
  users: boolean;
  patients: boolean;
  results: boolean;
  upload_results: boolean;
  audit: boolean;
  archive: boolean;
  settings: boolean;
};

export type RolePermissionsMatrix = {
  source: "database" | "file" | "defaults";
  editable: boolean;
  rows: RolePermissionRow[];
  message: string | null;
};

const DEFAULT_DEPT_PERMS: Record<RolePermissionKey, boolean> = {
  users: false,
  patients: true,
  results: true,
  upload_results: true,
  audit: false,
  archive: false,
  settings: false,
};

type CacheMap = Record<string, Record<RolePermissionKey, boolean>>;

let cache: CacheMap | null = null;
let cacheSource: RolePermissionsMatrix["source"] = "defaults";
let cachedRoleOrder: string[] = [...RBAC_ROLES];

function emptyPerms(overrides: Partial<Record<RolePermissionKey, boolean>> = {}): Record<RolePermissionKey, boolean> {
  return { ...DEFAULT_DEPT_PERMS, ...overrides };
}

function defaultsMap(): CacheMap {
  return {
    super_admin: {
      users: true,
      patients: true,
      results: true,
      upload_results: true,
      audit: true,
      archive: true,
      settings: true,
    },
    physician: emptyPerms({ upload_results: false }),
    medical_records: emptyPerms({
      audit: true,
      archive: true,
      upload_results: true,
    }),
    laboratory: emptyPerms(),
    radiology: emptyPerms(),
    endoscopy: emptyPerms(),
  };
}

function filePath(): string {
  const root = findRepoRoot();
  return path.resolve(root, "artifacts", "api-server", "data", "role-permissions.json");
}

export async function listRbacRoles(): Promise<string[]> {
  const departments = await departmentsRepo.listDepartments();
  const deptCodes = departments.map((d) => d.code);
  const roles = ["super_admin", ...deptCodes, "physician"];
  cachedRoleOrder = Array.from(new Set(roles));
  return cachedRoleOrder;
}

function rowFromPerms(role: string, perms: Record<RolePermissionKey, boolean>): RolePermissionRow {
  const locked = role === "super_admin";
  return {
    role,
    users: locked ? true : Boolean(perms.users),
    patients: locked ? true : Boolean(perms.patients),
    results: locked ? true : Boolean(perms.results),
    upload_results: locked ? true : Boolean(perms.upload_results),
    audit: locked ? true : Boolean(perms.audit),
    archive: locked ? true : Boolean(perms.archive),
    settings: locked ? true : Boolean(perms.settings),
  };
}

function rowsFromMap(map: CacheMap, roles: string[]): RolePermissionRow[] {
  return roles.map((role) => {
    const perms =
      map[role] ?? (role === "super_admin" ? defaultsMap().super_admin! : emptyPerms());
    return rowFromPerms(role, perms);
  });
}

async function tableExists(): Promise<boolean> {
  try {
    await getPool();
    const result = await request().query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.role_permissions', N'U') IS NULL THEN 0 ELSE 1 END AS present
    `);
    return Number((result.recordset[0] as { present: number }).present) === 1;
  } catch {
    return false;
  }
}

async function loadFromDatabase(): Promise<CacheMap | null> {
  if (!(await tableExists())) return null;
  await getPool();
  const result = await request().query(`
    SELECT role, permission, allowed
    FROM dbo.role_permissions
  `);
  const map = defaultsMap();
  const roles = await listRbacRoles();
  for (const role of roles) {
    if (!map[role]) map[role] = emptyPerms();
  }
  for (const row of result.recordset as Array<{ role: string; permission: string; allowed: boolean }>) {
    const role = String(row.role);
    const permission = String(row.permission) as RolePermissionKey;
    if (!ROLE_PERMISSION_KEYS.includes(permission)) continue;
    if (!map[role]) map[role] = emptyPerms();
    map[role]![permission] = Boolean(row.allowed);
  }
  map.super_admin = defaultsMap().super_admin!;
  return map;
}

function loadFromFile(): CacheMap | null {
  try {
    const target = filePath();
    if (!fs.existsSync(target)) return null;
    const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as {
      rows?: Array<Partial<RolePermissionRow> & { role: string }>;
    };
    if (!Array.isArray(parsed.rows)) return null;
    const map = defaultsMap();
    for (const row of parsed.rows) {
      const fallbackUpload =
        row.upload_results !== undefined
          ? Boolean(row.upload_results)
          : row.role === "physician"
            ? false
            : Boolean(row.results);
      map[row.role] = emptyPerms({
        users: Boolean(row.users),
        patients: Boolean(row.patients),
        results: Boolean(row.results),
        upload_results: fallbackUpload,
        audit: Boolean(row.audit),
        archive: Boolean(row.archive),
        settings: Boolean(row.settings),
      });
    }
    map.super_admin = defaultsMap().super_admin!;
    return map;
  } catch {
    return null;
  }
}

function saveToFile(map: CacheMap, roles: string[]): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({ updatedAt: new Date().toISOString(), rows: rowsFromMap(map, roles) }, null, 2),
    "utf8",
  );
}

async function saveToDatabase(map: CacheMap, roles: string[], updatedById: number | null): Promise<boolean> {
  if (!(await tableExists())) return false;
  await getPool();
  try {
    for (const role of roles) {
      for (const permission of ROLE_PERMISSION_KEYS) {
        const allowed = role === "super_admin" ? true : Boolean(map[role]?.[permission]);
        await request()
          .input("role", sql.NVarChar(32), role)
          .input("permission", sql.NVarChar(32), permission)
          .input("allowed", sql.Bit, allowed)
          .input("updatedById", sql.Int, updatedById)
          .query(`
            MERGE dbo.role_permissions AS target
            USING (SELECT @role AS role, @permission AS permission) AS source
            ON target.role = source.role AND target.permission = source.permission
            WHEN MATCHED THEN
              UPDATE SET allowed = @allowed, updated_at = SYSDATETIMEOFFSET(), updated_by_id = @updatedById
            WHEN NOT MATCHED THEN
              INSERT (role, permission, allowed, updated_by_id)
              VALUES (@role, @permission, @allowed, @updatedById);
          `);
      }
    }
    return true;
  } catch {
    // Likely missing upload_results in CK_role_permissions_permission until 017 is applied.
    return false;
  }
}

export async function seedPermissionsForDepartment(
  code: string,
  opts?: { audit?: boolean; archive?: boolean },
): Promise<void> {
  if (!(await tableExists())) {
    await ensureRolePermissionsCache();
    if (cache) {
      cache[code] = emptyPerms({
        audit: Boolean(opts?.audit),
        archive: Boolean(opts?.archive),
      });
    }
    return;
  }
  await getPool();
  const perms: Record<RolePermissionKey, boolean> = emptyPerms({
    audit: Boolean(opts?.audit),
    archive: Boolean(opts?.archive),
  });
  for (const permission of ROLE_PERMISSION_KEYS) {
    try {
      await request()
        .input("role", sql.NVarChar(32), code)
        .input("permission", sql.NVarChar(32), permission)
        .input("allowed", sql.Bit, perms[permission])
        .query(`
          MERGE dbo.role_permissions AS target
          USING (SELECT @role AS role, @permission AS permission) AS source
          ON target.role = source.role AND target.permission = source.permission
          WHEN NOT MATCHED THEN
            INSERT (role, permission, allowed) VALUES (@role, @permission, @allowed);
        `);
    } catch {
      // Skip keys not yet allowed by the DB CHECK constraint.
    }
  }
  await refreshRolePermissionsCache();
}

export async function refreshRolePermissionsCache(): Promise<void> {
  const roles = await listRbacRoles();
  cachedRoleOrder = roles;
  const fromDb = await loadFromDatabase();
  if (fromDb) {
    cache = fromDb;
    cacheSource = "database";
    return;
  }
  const fromFile = loadFromFile();
  if (fromFile) {
    cache = fromFile;
    cacheSource = "file";
    return;
  }
  cache = defaultsMap();
  cacheSource = "defaults";
}

export async function ensureRolePermissionsCache(): Promise<void> {
  if (!cache) await refreshRolePermissionsCache();
}

export function roleHasPermission(role: string, permission: RolePermissionKey): boolean {
  if (role === "super_admin") return true;
  const map = cache ?? defaultsMap();
  if (map[role]) return Boolean(map[role]?.[permission]);
  return Boolean(DEFAULT_DEPT_PERMS[permission]);
}

export async function getRolePermissionsMatrix(): Promise<RolePermissionsMatrix> {
  await ensureRolePermissionsCache();
  const roles = await listRbacRoles();
  const source = cacheSource;
  const dbPresent = await tableExists();
  return {
    source,
    editable: true,
    rows: rowsFromMap(cache ?? defaultsMap(), roles),
    message: dbPresent
      ? null
      : "Persisting to local config file until dbo.role_permissions is created (run docs/migration/sql/003_create_role_permissions.sql).",
  };
}

export async function saveRolePermissionsMatrix(
  rows: RolePermissionRow[],
  updatedById: number | null,
): Promise<RolePermissionsMatrix> {
  const roles = await listRbacRoles();
  const allowed = new Set(roles);
  const map = defaultsMap();
  for (const role of roles) {
    if (!map[role]) map[role] = emptyPerms();
  }
  for (const row of rows) {
    if (!allowed.has(row.role)) continue;
    map[row.role] = emptyPerms({
      users: Boolean(row.users),
      patients: Boolean(row.patients),
      results: Boolean(row.results),
      upload_results: Boolean(row.upload_results),
      audit: Boolean(row.audit),
      archive: Boolean(row.archive),
      settings: Boolean(row.settings),
    });
  }
  map.super_admin = defaultsMap().super_admin!;

  const savedDb = await saveToDatabase(map, roles, updatedById);
  if (!savedDb) {
    saveToFile(map, roles);
    cache = map;
    cacheSource = "file";
    const matrix = await getRolePermissionsMatrix();
    return {
      ...matrix,
      source: "file",
      message:
        "Saved to local config file. To persist Upload Results in SQL Server, run docs/migration/sql/017_role_permission_upload_results.sql in SSMS, then save again.",
    };
  }
  cache = map;
  cacheSource = "database";
  return getRolePermissionsMatrix();
}
