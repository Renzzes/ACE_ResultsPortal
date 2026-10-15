# Disaster recovery restore procedure

Do **not** run this procedure as part of Phase 4 validation. It is the controlled sequence for a real outage.

Target database: **`ACE_ResultsPortal` only**.

Never restore into, overlay, or connect this application to `LiveDB_ACE`, `CodeGeneratorDB`, `ACE_PatientPortal`, or other hospital databases.

## Preconditions

- Matched backups of `ACE_ResultsPortal` and `RESULT_STORAGE_ROOT` from the same window
- Hospital IT / DBA approval
- Known `RESULT_STORAGE_ROOT` path for the destination host
- Root `.env` with `DB_DATABASE=ACE_ResultsPortal` and `RESULT_STORAGE_ROOT` (no `node --env-file`, no `NODE_PATH`)

## Sequence

1. **Provision SQL Server / database**  
   Ensure the instance can host `ACE_ResultsPortal`. Do not `CREATE DATABASE` from application code. Do not drop other hospital databases.

2. **Restore `ACE_ResultsPortal`**  
   DBA restores the database backup onto the instance. Confirm `DB_DATABASE=ACE_ResultsPortal`.

3. **Restore result-file storage**  
   Copy the file-storage backup onto the destination `RESULT_STORAGE_ROOT`.  
   Copy/preserve: do not delete the backup set after copy until verification succeeds.  
   Do not skip `results/` or legacy files at the storage root.

4. **Verify file paths**  
   `RESULT_STORAGE_ROOT` in `.env` must resolve to the restored tree. Relative values are resolved from the repository root, not from `process.cwd()`.

5. **Run the storage integrity check** (read-only):

   ```
   pnpm --filter @workspace/scripts run verify-storage
   ```

   Investigate CASE A (row without file) and CASE B (file without row). Do not automatically delete either side.

6. **Start the API** from `artifacts/api-server` after build:

   ```
   pnpm --filter @workspace/api-server run start
   ```

7. **Health check**

   ```
   GET /api/healthz
   ```

   Expected: HTTP 200 `{"status":"ok"}`.

8. **Representative result download**  
   Use a known result whose **current status** allows the actor under test.  
   If the result is `pending` or `archived`, physician and portal download must remain denied. Do not release a result merely to test streaming.

9. **Verify authorization**  
   Confirm physician (assigned + released), portal (own patient + released), and staff RBAC still match Phase 3. A valid filesystem path is not enough to download.

10. **Verify audit integrity**  
    Confirm recent `audit_logs` rows survived the database restore. New health/login actions after startup should append new rows (no truncate).

## If CASE A or CASE B appears

- CASE A: restore a file copy from the same window as the database, or accept that those results cannot be downloaded until the matching binary is found. Do not delete the database row as a “cleanup” step without an explicit incident decision.
- CASE B: keep the orphan file until it is identified. Do not mass-delete storage to “make verify-storage green”.

## What this procedure is not

- It is not application archive/restore (`pending` ↔ `archived`).
- It is not a license to run `DROP`/`TRUNCATE`/`DELETE` against live fixtures.
- It is not a restore of any database other than `ACE_ResultsPortal`.
