/**
 * Read-only schema readiness for migration 019 (ACE_ResultsPortal only).
 * Usage:
 *   pnpm exec tsx ./src/preflight-schema-check.ts local
 *   pnpm exec tsx ./src/preflight-schema-check.ts production
 */
import fs from "node:fs";
import { closePool, getPool, initDb, loadDbConfig, loadRootEnv } from "@workspace/db";

const mode = (process.argv[2] || "local").toLowerCase();

function loadProdEnv() {
  const raw = fs.readFileSync("D:/ACERPTS/app/.env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

async function main() {
  if (mode === "production") {
    loadProdEnv();
  } else {
    loadRootEnv();
  }

  const cfg = loadDbConfig();
  console.log(`MODE=${mode}`);
  console.log(`DB_DATABASE=${cfg.database}`);
  console.log(`DB_SERVER=${cfg.server}`);
  if (cfg.database !== "ACE_ResultsPortal") {
    throw new Error(`Refusing non-portal database: ${cfg.database}`);
  }

  await initDb();
  const pool = await getPool();
  const dbName = (await pool.request().query("SELECT DB_NAME() AS name")).recordset[0]
    .name as string;
  console.log(`CONNECTED_DB=${dbName}`);
  if (dbName !== "ACE_ResultsPortal") {
    throw new Error(`Connected to unexpected database: ${dbName}`);
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
      ) AS patient_hash_nullable,
      (
        SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_results_access_code_email_status'
      ) AS ck_exists
  `);
  console.log(`SCHEMA=${JSON.stringify(cols.recordset[0])}`);

  if (mode === "local") {
    console.log(`PORT=${process.env.PORT ?? ""}`);
    console.log(`RESULT_STORAGE_ROOT=${process.env.RESULT_STORAGE_ROOT ?? ""}`);
    console.log(`SMTP_HOST=${process.env.SMTP_HOST ?? ""}`);
    console.log(
      `SMTP_CONFIGURED=${
        process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS ? "yes" : "no"
      }`,
    );
    console.log(`JWT_SET=${process.env.JWT_SECRET ? "yes" : "no"}`);
    console.log(`HIS_USER_SET=${process.env.HIS_DB_USER ? "yes" : "no"}`);
    console.log(`HIS_PASS_SET=${process.env.HIS_DB_PASSWORD ? "yes" : "no"}`);
    console.log(`HOSPITAL_DB=${process.env.HOSPITAL_DB_DATABASE ?? ""}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
