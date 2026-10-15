# SQL Server Migration

## Previous architecture

ACE Results Portal stored application data in **PostgreSQL** through **Drizzle ORM** and the `pg` driver (`lib/db`).

Tables (verified from the former Drizzle schema):

- `users`
- `patients`
- `patient_physicians`
- `results`
- `audit_logs`

There were no database-level foreign keys. `failed_login_attempts` was modeled as a serial-like identity. `scheduled_release_date` was stored as text. Patient access codes were stored as plaintext `access_code`.

## New architecture

```
Browser (React 19 + Vite)
  → Express API
    → Service / route handlers
      → Parameterized mssql repositories + connection pool
        → Microsoft SQL Server 2019
          → ACE_ResultsPortal
```

PostgreSQL, Drizzle, and `pg` are no longer runtime dependencies.

## Database name

```text
ACE_ResultsPortal
```

Configured only through:

```env
DB_DATABASE=ACE_ResultsPortal
```

Do **not** point this application at `CodeGeneratorDB`, `LiveDB_ACE`, `ACE_PatientPortal`, or any other existing hospital database. The data layer refuses those names.

## Connection configuration

```env
DB_SERVER=198.15.0.201
DB_INSTANCE=
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=<REDACTED>
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
DB_DATABASE=ACE_ResultsPortal
DB_POOL_MAX=10
DB_POOL_MIN=0
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=15000
DB_REQUEST_TIMEOUT_MS=30000
```

Production should use a dedicated SQL login with rights limited to `ACE_ResultsPortal`. Do not permanently run the application as `sa`. Cursor does not create that login.

The pool is created once in `lib/db/src/pool.ts` and reused. Queries are parameterized. Connection strings and `DB_PASSWORD` are not logged.

## Schema conversion

| PostgreSQL | SQL Server |
| --- | --- |
| `serial` | `INT IDENTITY(1,1)` |
| `text` | `NVARCHAR(n)` / `NVARCHAR(MAX)` |
| `boolean` | `BIT` |
| `timestamp` | `DATETIMEOFFSET(7)` |
| `date` | `DATE` |
| enums | `NVARCHAR` + `CHECK` |

Integrity corrections:

- `failed_login_attempts` → `INT NOT NULL DEFAULT 0`
- `scheduled_release_date` → `DATE`
- `access_code` → `access_code_hash` (`NVARCHAR(255)`, bcrypt)

## Tables and columns

### `dbo.users`

`id`, `username` (unique), `password_hash`, `first_name`, `last_name`, `email`, `role`, `is_active`, `failed_login_attempts`, `locked_until`, `last_login_at`, `created_at`, `updated_at`

### `dbo.patients`

`id`, `patient_his_id` (unique), `last_name`, `first_name`, `middle_name`, `date_of_birth`, `mobile_number`, `email`, `access_code_hash`, `created_by_id`, `created_at`, `updated_at`

### `dbo.patient_physicians`

`id`, `patient_id`, `physician_id`, `assigned_at`, `assigned_by_id`, unique `(patient_id, physician_id)`

### `dbo.results`

`id`, `patient_id`, `category`, `file_name`, `original_file_name`, `file_type`, `file_size_bytes`, `release_option`, `scheduled_release_date`, `date_released`, `status`, `remarks`, `uploaded_by_id`, `uploaded_at`, `created_at`, `updated_at`

### `dbo.audit_logs`

`id`, `action`, `user_id`, `user_name`, `patient_his_id`, `result_id`, `ip_address`, `details`, `created_at`

## Foreign keys

All `ON DELETE NO ACTION` except where SET NULL is required for history:

- `patients.created_by_id` → `users.id` **SET NULL**
- `results.patient_id` → `patients.id` **NO ACTION** (results are not cascade-deleted)
- `results.uploaded_by_id` → `users.id` **NO ACTION**
- `patient_physicians.patient_id` → `patients.id` **NO ACTION**
- `patient_physicians.physician_id` → `users.id` **NO ACTION**
- `patient_physicians.assigned_by_id` → `users.id` **NO ACTION**
- `audit_logs.user_id` → `users.id` **SET NULL**
- `audit_logs.result_id` → `results.id` **SET NULL**

## Indexes (query-justified)

- `users.username` (unique), `users.role`
- `patients.patient_his_id` (unique), `patients.last_name`, `patients.created_by_id`
- `patient_physicians (patient_id, physician_id)` unique, `physician_id`, `assigned_by_id`
- `results.patient_id`, `status`, `category`, `uploaded_at`, `uploaded_by_id`, `(status, release_option, scheduled_release_date)`
- `audit_logs.created_at`, `user_id`, `action`, `patient_his_id`

`access_code_hash` is **not** unique (bcrypt hashes of identical codes would still differ; uniqueness is enforced at generation time for plaintext codes).

## Database creation procedure

1. Review `docs/migration/sql/001_create_database_and_schema.sql`.
2. Execute it **manually** in SSMS or `sqlcmd` as a DBA against `198.15.0.201,1433`.
3. Confirm `ACE_ResultsPortal` exists and contains the five tables.
4. Copy `.env.example` to `.env` and set secrets.
5. Optionally run `pnpm --filter @workspace/scripts seed-admin` with `ADMIN_BOOTSTRAP_PASSWORD` set.

## Manual execution requirements

Cursor **must not** and **did not** execute:

- `CREATE DATABASE`
- `DROP DATABASE`
- `ALTER DATABASE`
- `DROP TABLE`
- `TRUNCATE TABLE`

Existing hospital databases were not inspected or altered.

## Rollback considerations

If the new database should not be used:

1. Point the application away from `ACE_ResultsPortal` (do not drop it from this project).
2. Database drop, if ever required, is a DBA decision outside this application.

Uploaded files remain under `artifacts/api-server/uploads` and were not migrated or deleted.

## Environment variables

See `.env.example`. Never commit `.env`. Never put `DB_PASSWORD`, `JWT_SECRET`, or bootstrap passwords in documentation or source.
