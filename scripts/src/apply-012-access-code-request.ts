import { loadRootEnv, initDb, getPool, closePool } from "@workspace/db";

loadRootEnv();

async function main() {
  await initDb();
  const pool = await getPool();
  const check = await pool
    .request()
    .query("SELECT COL_LENGTH('dbo.patients', 'access_code_requested_at') AS col_len");
  const colLen = (check.recordset[0] as { col_len: number | null } | undefined)?.col_len;
  console.log("before:", colLen);
  if (colLen == null) {
    await pool
      .request()
      .query("ALTER TABLE dbo.patients ADD access_code_requested_at DATETIMEOFFSET NULL");
    console.log("column added");
  } else {
    console.log("column already exists");
  }
  const after = await pool
    .request()
    .query("SELECT COL_LENGTH('dbo.patients', 'access_code_requested_at') AS col_len");
  console.log("after:", (after.recordset[0] as { col_len: number | null }).col_len);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
