import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { closePool, getPool, initDb, loadDbConfig, loadRootEnv } from "@workspace/db";

loadRootEnv();

const additiveSql = readFileSync(
  new URL("../../docs/migration/sql/015_auth_sessions_portal.sql", import.meta.url),
  "utf8",
);
const revokeSql = readFileSync(
  new URL("../../docs/migration/sql/015_auth_sessions_revoke_legacy.sql", import.meta.url),
  "utf8",
);

test("portal session migration is additive and does not touch clinical tables", () => {
  assert.match(additiveSql, /ADD public_id CHAR\(22\) NULL/);
  assert.match(additiveSql, /ADD portal VARCHAR\(16\) NULL/);
  assert.match(additiveSql, /CK_auth_sessions_portal/);
  assert.match(additiveSql, /portal IN \(N'admin', N'staff', N'doctor', N'patient'\)/);
  assert.match(additiveSql, /CREATE UNIQUE INDEX IX_auth_sessions_public_id/);
  assert.match(additiveSql, /INCLUDE \(revoked_at, expires_at, portal\)/);
  assert.match(additiveSql, /WHERE public_id IS NOT NULL/);
  const executable = additiveSql.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/\bDELETE\b/i.test(executable), false);
  assert.equal(/\bDROP\s+TABLE\b/i.test(executable), false);
  assert.equal(/\bUPDATE\b/i.test(executable), false);
  for (const forbidden of [
    "dbo.results",
    "dbo.result_reviews",
    "patient_departments",
    "role_permissions",
    "LiveDB_ACE",
    "ShanScheduler",
  ]) {
    assert.equal(executable.includes(forbidden), false, forbidden);
  }
});

test("legacy revocation script is documented for cutover and is not the foundation migration", () => {
  assert.match(revokeSql, /DO NOT RUN THIS SCRIPT DURING PHASE H\.5\.1/);
  assert.match(revokeSql, /UPDATE dbo\.auth_sessions/);
  assert.match(revokeSql, /WHERE portal IS NULL/);
  assert.match(revokeSql, /revoked_at = SYSDATETIMEOFFSET\(\)/);
  assert.equal(/\bDELETE\b/i.test(revokeSql), false);
  assert.equal(additiveSql.includes("UPDATE dbo.auth_sessions"), false);
});

test("LIVE auth_sessions portal foundation", async () => {
  let database = "";
  try {
    database = loadDbConfig().database;
  } catch (err) {
    assert.fail(`Database is not configured: ${err instanceof Error ? err.message : String(err)}`);
  }
  assert.equal(database, "ACE_ResultsPortal", `Unexpected database "${database}". Expected ACE_ResultsPortal.`);

  try {
    await initDb();
    const pool = await getPool();

    const dbName = await pool.request().query("SELECT DB_NAME() AS name");
    assert.equal(dbName.recordset[0]?.name, "ACE_ResultsPortal");

    const columns = await pool.request().query(`
      SELECT c.name, ty.name AS type_name, c.max_length, c.is_nullable
      FROM sys.columns c
      INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE c.object_id = OBJECT_ID(N'dbo.auth_sessions')
        AND c.name IN (N'public_id', N'portal')
    `);
    const byName = new Map(columns.recordset.map((row: { name: string }) => [row.name, row]));
    const publicId = byName.get("public_id") as { type_name: string; max_length: number; is_nullable: boolean } | undefined;
    const portal = byName.get("portal") as { type_name: string; max_length: number; is_nullable: boolean } | undefined;
    assert.ok(publicId, "public_id column is missing. Run docs/migration/sql/015_auth_sessions_portal.sql");
    assert.equal(publicId.type_name, "char");
    assert.equal(publicId.max_length, 22);
    assert.equal(Boolean(publicId.is_nullable), true);
    assert.ok(portal, "portal column is missing. Run docs/migration/sql/015_auth_sessions_portal.sql");
    assert.equal(portal.type_name, "varchar");
    assert.equal(portal.max_length, 16);
    assert.equal(Boolean(portal.is_nullable), true);

    const checks = await pool.request().query(`
      SELECT definition
      FROM sys.check_constraints
      WHERE name = N'CK_auth_sessions_portal'
        AND parent_object_id = OBJECT_ID(N'dbo.auth_sessions')
    `);
    assert.equal(checks.recordset.length, 1);
    const definition = String(checks.recordset[0]?.definition ?? "");
    for (const value of ["admin", "staff", "doctor", "patient"]) {
      assert.match(definition, new RegExp(value));
    }

    const index = await pool.request().query(`
      SELECT i.is_unique, i.has_filter, i.filter_definition
      FROM sys.indexes i
      WHERE i.name = N'IX_auth_sessions_public_id'
        AND i.object_id = OBJECT_ID(N'dbo.auth_sessions')
    `);
    assert.equal(index.recordset.length, 1, "IX_auth_sessions_public_id is missing");
    assert.equal(Boolean(index.recordset[0]?.is_unique), true);
    assert.equal(Boolean(index.recordset[0]?.has_filter), true);
    assert.match(String(index.recordset[0]?.filter_definition ?? ""), /public_id\]?\s+IS NOT NULL/i);

    const included = await pool.request().query(`
      SELECT c.name
      FROM sys.index_columns ic
      INNER JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      INNER JOIN sys.indexes i
        ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      WHERE i.name = N'IX_auth_sessions_public_id'
        AND i.object_id = OBJECT_ID(N'dbo.auth_sessions')
        AND ic.is_included_column = 1
      ORDER BY c.name
    `);
    const includeNames = included.recordset.map((row: { name: string }) => row.name);
    assert.deepEqual(includeNames, ["expires_at", "portal", "revoked_at"]);

    const fk = await pool.request().query(`
      SELECT name
      FROM sys.foreign_keys
      WHERE name = N'FK_auth_sessions_user'
        AND parent_object_id = OBJECT_ID(N'dbo.auth_sessions')
    `);
    assert.equal(fk.recordset.length, 1);

    const hashUnique = await pool.request().query(`
      SELECT name
      FROM sys.indexes
      WHERE name = N'UQ_auth_sessions_refresh_token_hash'
        AND object_id = OBJECT_ID(N'dbo.auth_sessions')
        AND is_unique = 1
    `);
    assert.equal(hashUnique.recordset.length, 1);

    const counts = await pool.request().query(`
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN portal IS NULL THEN 1 ELSE 0 END) AS null_portal_rows,
        SUM(CASE WHEN public_id IS NOT NULL THEN 1 ELSE 0 END) AS public_id_rows,
        SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active_rows
      FROM dbo.auth_sessions
    `);
    const row = counts.recordset[0] as {
      total_rows: number;
      null_portal_rows: number | null;
      public_id_rows: number | null;
      active_rows: number | null;
    };
    const partial = await pool.request().query(`
      SELECT
        SUM(CASE WHEN portal IS NULL AND public_id IS NOT NULL THEN 1 ELSE 0 END) AS portal_missing,
        SUM(CASE WHEN portal IS NOT NULL AND public_id IS NULL THEN 1 ELSE 0 END) AS public_id_missing
      FROM dbo.auth_sessions
    `);
    assert.equal(Number(partial.recordset[0]?.portal_missing ?? 0), 0);
    assert.equal(Number(partial.recordset[0]?.public_id_missing ?? 0), 0);
    assert.ok(Number(row.null_portal_rows ?? 0) <= Number(row.total_rows));

    const duplicates = await pool.request().query(`
      SELECT COUNT(*) AS duplicate_groups
      FROM (
        SELECT public_id
        FROM dbo.auth_sessions
        WHERE public_id IS NOT NULL
        GROUP BY public_id
        HAVING COUNT(*) > 1
      ) d
    `);
    assert.equal(Number(duplicates.recordset[0]?.duplicate_groups ?? 0), 0);

    for (const table of ["dbo.users", "dbo.results", "dbo.result_reviews", "dbo.patient_departments", "dbo.departments", "dbo.role_permissions"]) {
      const marker = await pool.request().query(`
        SELECT COL_LENGTH(N'${table}', N'public_id') AS public_id_len
      `);
      assert.equal(marker.recordset[0]?.public_id_len, null, `${table} must not gain public_id`);
    }

    assert.equal(Number.isFinite(Number(row.active_rows ?? 0)), true);
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    assert.fail(`ACE_ResultsPortal is unavailable: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await closePool();
  }
});
