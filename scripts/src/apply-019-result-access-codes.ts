/**
 * Local-only: apply migration 019 against ACE_ResultsPortal (idempotent).
 * Does not touch LiveDB_ACE / ShanScheduler / production.
 */
import fs from "node:fs";
import path from "node:path";
import { closePool, getPool, initDb, loadDbConfig, loadRootEnv } from "@workspace/db";

loadRootEnv();

async function main() {
  const cfg = loadDbConfig();
  if (cfg.database !== "ACE_ResultsPortal") {
    throw new Error(`Refusing to run: database is "${cfg.database}", expected ACE_ResultsPortal`);
  }

  await initDb();
  const pool = await getPool();
  const dbName = await pool.request().query("SELECT DB_NAME() AS name");
  const name = (dbName.recordset[0] as { name: string }).name;
  if (name !== "ACE_ResultsPortal") {
    throw new Error(`Connected to ${name}; refusing to apply 019`);
  }

  const sqlPath = path.resolve(import.meta.dirname, "../../docs/migration/sql/019_result_access_codes.sql");
  const raw = fs.readFileSync(sqlPath, "utf8");
  // Strip block comments and USE/GO batches; run statement groups sequentially.
  const withoutComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const batches = withoutComments
    .split(/\bGO\b/i)
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !/^USE\b/i.test(b) && !/^SET\b/i.test(b));

  for (const batch of batches) {
    await pool.request().query(batch);
  }

  const cols = await pool.request().query(`
    SELECT
      COL_LENGTH(N'dbo.results', N'access_code_hash') AS hash_len,
      COL_LENGTH(N'dbo.results', N'access_code_encrypted') AS enc_len,
      COL_LENGTH(N'dbo.results', N'access_code_issued_at') AS issued_len,
      COL_LENGTH(N'dbo.results', N'access_code_emailed_at') AS emailed_len,
      COL_LENGTH(N'dbo.results', N'access_code_email_status') AS status_len,
      (
        SELECT c.is_nullable
        FROM sys.columns c
        WHERE c.object_id = OBJECT_ID(N'dbo.patients') AND c.name = N'access_code_hash'
      ) AS patient_hash_nullable
  `);
  console.log("019 applied/verified:", cols.recordset[0]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
