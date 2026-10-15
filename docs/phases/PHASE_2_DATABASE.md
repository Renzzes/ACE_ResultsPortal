# Phase 2 — SQL Server / Data layer

Status: **VALIDATED**

## Database

| Item | Value |
| --- | --- |
| Engine | Microsoft SQL Server 2019 |
| Server | `198.15.0.201:1433` |
| Database | **ACE_ResultsPortal** |
| Application login | Configured via root `.env` (`DB_*`). Production should not permanently use `sa`. |

The API must not use `LiveDB_ACE`, `CodeGeneratorDB`, `ACE_PatientPortal`, or other names blocked in `lib/db/src/config.ts`.

**CREATE DATABASE was executed manually by the developer.** Cursor did not run `CREATE DATABASE`, `DROP DATABASE`, or automatic migrations at API start.

## Tables

### `dbo.users`

| | |
| --- | --- |
| Primary key | `id` INT IDENTITY |
| Unique | `username` (`UQ_users_username`) |
| Check | `role IN (super_admin, medical_records, laboratory, radiology, physician)`; `failed_login_attempts >= 0` |
| Defaults | `is_active` BIT 1; `failed_login_attempts` INT 0 |
| Timestamps | `DATETIMEOFFSET(7)` `created_at`, `updated_at`; `last_login_at`, `locked_until` nullable |
| Password | `password_hash` NVARCHAR(255) — bcrypt, never plaintext |
| Index | `IX_users_role` on `role` INCLUDE (`is_active`) |

### `dbo.patients`

| | |
| --- | --- |
| Primary key | `id` INT IDENTITY |
| Unique | `patient_his_id` (`UQ_patients_patient_his_id`) |
| Access code | `access_code_hash` NVARCHAR(255) — **bcrypt only**; plaintext is never persisted |
| FK | `created_by_id` → `users.id` **ON DELETE SET NULL** |
| Types | `date_of_birth` DATE |
| Indexes | `IX_patients_last_name`, `IX_patients_created_by_id` |

### `dbo.patient_physicians`

| | |
| --- | --- |
| Primary key | `id` INT IDENTITY |
| Unique | `(patient_id, physician_id)` — duplicate assignments rejected |
| FKs | `patient_id` → `patients.id` **ON DELETE NO ACTION**; `physician_id` → `users.id` **ON DELETE NO ACTION**; `assigned_by_id` → `users.id` **ON DELETE NO ACTION** |
| Indexes | `IX_patient_physicians_physician_id`, `IX_patient_physicians_assigned_by_id` |

Results are not cascade-deleted when a patient is removed. Patient DELETE is refused (HTTP 409) if any result rows exist.

### `dbo.results`

| | |
| --- | --- |
| Primary key | `id` INT IDENTITY |
| Status | `NVARCHAR(16)` CHECK: **`pending`**, **`released`**, **`archived`**. Default `pending`. |
| Categories | CHECK: `laboratory`, `radiology`, `ultrasound`, `ct_scan`, `mri`, `ecg`, `echo_2d`, `rehabilitation`, `other` |
| File type | CHECK: `pdf`, `jpeg`, `png` |
| Release option | CHECK: `immediate`, `after_physician_review`, `scheduled` |
| Scheduled date | `scheduled_release_date` **DATE** |
| FKs | `patient_id` → `patients.id` **ON DELETE NO ACTION**; `uploaded_by_id` → `users.id` **ON DELETE NO ACTION** |
| Indexes | patient, status, category, uploaded_at, uploaded_by, scheduled-release composite |

### `dbo.audit_logs`

| | |
| --- | --- |
| Primary key | `id` INT IDENTITY |
| Actions | CHECK: `login`, `logout`, `upload`, `edit`, `delete`, `view`, `download`, `access_denied`, `access_code_regen` |
| FKs | `user_id` → `users.id` **ON DELETE SET NULL**; `result_id` → `results.id` **ON DELETE SET NULL` |
| Indexes | `created_at DESC`, `user_id`, `action`, `patient_his_id` |

Application writes go through `artifacts/api-server/src/lib/audit.ts` → `lib/db/src/repos/audit-logs.ts`.

### `dbo.auth_sessions`

| | |
| --- | --- |
| Primary key | `id` INT IDENTITY |
| Hash | `refresh_token_hash` **CHAR(64)** SHA-256 hex of the refresh JWT — **never plaintext** |
| Unique | `UQ_auth_sessions_refresh_token_hash` |
| FK | `user_id` → `users.id` **ON DELETE NO ACTION** |
| Expiry / revoke | `expires_at` DATETIMEOFFSET NOT NULL; `revoked_at` nullable |
| Index | `IX_auth_sessions_user_id` INCLUDE (`revoked_at`, `expires_at`) |

**The `auth_sessions` table was created by the developer executing `002_create_auth_sessions.sql`.** Cursor generated the script and did not execute it.

## Result lifecycle (data)

```text
upload → pending
       → (immediate upload or POST .../release immediate) → released
       → PATCH status archived → archived
       → POST /archive/{id}/restore → pending
```

Scheduled rows stay `pending` until the in-process worker sets `released`. Restore does **not** set `released`.

## Migration scripts

| Script | Purpose | Who ran it |
| --- | --- | --- |
| `docs/migration/sql/001_create_database_and_schema.sql` | Create `ACE_ResultsPortal` (if missing) and core tables | **Developer, manually** |
| `docs/migration/sql/002_create_auth_sessions.sql` | Create `dbo.auth_sessions` only (USE `ACE_ResultsPortal`; no CREATE DATABASE) | **Developer, manually** |

The API **does not** run these scripts on startup.

## Application data access

Parameterized repositories in `lib/db/src/repos/`. Transactions: patient create+assign, result upload+audit, release, archive restore, result delete. Integrity types: INT counters, DATE scheduled release, BIT flags, DATETIMEOFFSET timestamps.
