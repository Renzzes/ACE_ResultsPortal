# Backup contract

This is the backup **contract** for ACE Results Portal. It does not install SQL Server Agent jobs, Windows scheduled tasks, or an in-application backup scheduler.

Backup means **copy and preserve** the live data. It does not mean move, archive, or delete the originals.

## Two backup domains

| Domain | What | Location |
| --- | --- | --- |
| A. Database | Metadata, users, patients, assignments, result status/release, audit, auth sessions | SQL Server database **`ACE_ResultsPortal`** |
| B. File storage | Diagnostic result binaries (PDF / JPEG / PNG) | Directory configured by **`RESULT_STORAGE_ROOT`** (default `<repo-root>/artifacts/api-server/uploads`) |

Do **not** back up:

- `LiveDB_ACE`
- `CodeGeneratorDB`
- `ACE_PatientPortal`
- any other hospital database

This application must not be used as a backup client for those databases.

## Required backup components

1. SQL Server database `ACE_ResultsPortal`
2. The entire result-file storage tree (`RESULT_STORAGE_ROOT`)

A **database-only** backup cannot restore complete application state: result rows would exist without their PDFs/images (CASE A).

A **file-only** backup cannot restore complete application state: binaries would exist without patients, assignments, release status, RBAC, or audit (CASE B / missing authorization).

Both components are required, taken from the **same backup window**.

## What the application stores where

SQL Server (`ACE_ResultsPortal`):

- users, sessions, patients, physician assignments
- result metadata (`file_name` is a **relative** storage key, not a host-specific absolute path)
- authorization/release/archive status
- audit logs

Filesystem (`RESULT_STORAGE_ROOT`):

- uploaded result objects (`results/<id>/result.<ext>` and any legacy root basenames)
- transient `tmp/` objects (in-progress uploads; not a substitute for a complete result)

Result binaries are not stored in SQL Server.

## Frequency (recommendation)

These are operational recommendations, not automated jobs:

| Item | Recommendation |
| --- | --- |
| Database | Daily full backup; more frequent log backups if the instance uses full recovery |
| File storage | Daily copy of `RESULT_STORAGE_ROOT` (file-level or volume snapshot) |
| After large upload batches | An extra file-storage copy in the same window as a database backup |

## Retention (recommendation)

Keep at least **14 days** of daily copies, and **one monthly** copy for 12 months, unless hospital policy requires longer. Confirm retention with hospital IT before production.

Do not implement retention by deleting live `RESULT_STORAGE_ROOT` files or by truncating `ACE_ResultsPortal` tables.

## Consistency and ordering

`file_name` in `dbo.results` must match a file under `RESULT_STORAGE_ROOT`.

Preferred backup order in one window:

1. Quiesce or pick a short idle period (API may stay up; in-flight uploads can leave `tmp/` files).
2. Copy `RESULT_STORAGE_ROOT` (including `results/` and legacy files).
3. Take a SQL Server backup of `ACE_ResultsPortal` immediately after, or use a volume snapshot of both if they share a consistent snapshot boundary.

If the database backup is newer than the file copy, newly uploaded rows may lack files (CASE A). If the file copy is newer than the database, extra files may lack rows (CASE B). Either mismatch is repaired only by restoring a **matched pair**, not by deleting live data.

SQL Server `BACKUP DATABASE` is a DBA operation on the SQL host. The Node API does not run `BACKUP DATABASE`.

## Restore dependency

See [RESTORE_PROCEDURE.md](./RESTORE_PROCEDURE.md).

Disaster recovery restore is a **paired** restore of `ACE_ResultsPortal` **and** `RESULT_STORAGE_ROOT`, then `verify-storage`, then API health and a representative authorized download.

## Archive vs backup

Application **archive** only changes result status. It does not copy files off-box and does not delete them.

Application **restore** (from archive) sets status to `pending`. It is not disaster-recovery restore of the storage volume.
