# Phase 2 — Data Integrity

## SQL Server types

| Column | Type | Notes |
| --- | --- | --- |
| `failed_login_attempts` | `INT` | Counter, not identity |
| `scheduled_release_date` | `DATE` | Was PostgreSQL text |
| `file_size_bytes` | `BIGINT` | |
| `created_at` / `updated_at` / `uploaded_at` / `last_login_at` / `locked_until` / `date_released` | `DATETIMEOFFSET(7)` | |
| `date_of_birth` | `DATE` | |
| `is_active` | `BIT` | |
| `access_code_hash` | `NVARCHAR(255)` | bcrypt |

Booleans, dates, counters, and sizes are not stored as strings.

## Foreign keys

Implemented in `001_create_database_and_schema.sql`. Medical results are **not** cascade-deleted when a patient row would be removed. Patient delete is refused with HTTP 409 if results exist; physician assignments are removed in a transaction first.

## Indexes

See `SQL_SERVER_MIGRATION.md`. Indexes match list/search/download/audit lookup paths.

## Transactions

| Operation | Behavior |
| --- | --- |
| Create patient + optional physician assignment | Single DB transaction. Invalid physician rolls back the patient insert. |
| Result upload | File is written first (multer). Metadata + audit insert run in a DB transaction. On DB failure the file is deleted. Filesystem write cannot be in the SQL transaction. |
| Result release / archive / restore | Status update + audit in one transaction. |
| Physician assign / unassign | Assignment + audit in one transaction. |

If audit logging fails on these paths, the transaction rolls back (`logAudit` throws). Login/portal failures use `logAuditBestEffort` so a downed audit table cannot be used to block lockout recording after the password check; the failure is still logged to the application logger.

## Audit integrity

Recorded actions: `login`, `logout`, `upload`, `edit`, `delete`, `view`, `download`, `access_denied`, `access_code_regen`.

Patient creation uses `edit` (the CHECK constraint has no `create` action). Expanding the action vocabulary requires a DBA-reviewed `ALTER TABLE` and is not done automatically.

## Unique constraints

- `users.username`
- `patients.patient_his_id`
- `patient_physicians (patient_id, physician_id)`

`access_code_hash` is not unique. Collision handling for plaintext codes is at generation time (random `ACE-XXXX-XXXX`).

## Archival strategy (no destructive change)

| Entity | Intended model |
| --- | --- |
| Users | `is_active = 0` (soft deactivate). DELETE API deactivates. |
| Results | `status = archived`. Restore returns to `pending`. |
| Patients | Hard delete only when **no** results exist. Recommended future model: deactivate/archive patients instead of DELETE. **Not implemented** — existing delete-without-results behavior is preserved. |

Uploaded binaries are not deleted on archive.

## Scheduled release

**Previously:** column existed; no worker.

**Now:**

- Column type is `DATE`
- An in-process interval (60s) in the API process releases rows where `status = pending`, `release_option = scheduled`, and `scheduled_release_date <= CAST(SYSUTCDATETIME() AS date)`
- This is **not** a durable external scheduler (SQL Agent / hangfire). If all API instances are down, due releases wait until a process starts.
- Multi-instance deployments may double-attempt; the UPDATE is idempotent on status.

Treat clustered/high-availability scheduling as a **Phase 4** item if SQL Agent is preferred.

## Database constraints

CHECK constraints cover `users.role`, `results.category`, `results.file_type`, `results.release_option`, `results.status`, and `audit_logs.action`.
