# Implementation Status

## PHASE 0 — SQL SERVER MIGRATION

STATUS: **Application code complete. Database not created by Cursor.**

### Completed

- PostgreSQL / Drizzle / `pg` removed from the application data layer
- `mssql` connection pool and repositories
- Schema script generated at `docs/migration/sql/001_create_database_and_schema.sql`
- Environment contract uses `DB_DATABASE=ACE_ResultsPortal` (not `LIVE_DB` / `CODE_GENERATOR_DB`)

### Remaining

- Developer must **manually execute** the SQL script on `198.15.0.201,1433`
- Developer must create `.env` with secrets
- Optional dedicated SQL login (not `sa`) for production

### Known Issues

- SQL Server connectivity cannot be claimed successful until the database exists and env vars are set
- No automated migration of historical PostgreSQL rows (greenfield database)

### Verification

- `CREATE DATABASE` was **not** executed by Cursor
- Live connection test is **blocked** on the database creation gate

---

## PHASE 1 — SECURITY

STATUS: **Implemented in code. Runtime verification pending database.**

### Completed

- Required `JWT_SECRET` (no fallback)
- Single admin bootstrap via env (`scripts/src/seed-admin.ts`)
- Access-code hashing
- Rate limits on login, refresh, portal verify
- Helmet + CORS allowlist
- Download tokens bound to `subjectId` with re-authorization
- Refresh httpOnly cookie (JSON body still returned for compatibility)
- Session bootstrap via `GET /api/auth/me`

### Remaining

- Move refresh tokens fully to httpOnly cookies (Phase 4/5)
- Access JWT still in `localStorage`

### Known Issues

- See `PHASE_1_SECURITY_HARDENING.md`

### Verification

- `pnpm typecheck` passed
- API production build passed
- Live login/lockout/portal tests require the SQL Server database

---

## PHASE 2 — DATA INTEGRITY

STATUS: **Schema designed; worker implemented in API process.**

### Completed

- Correct types (`INT` counter, `DATE` scheduled release, `BIT`, `DATETIMEOFFSET`)
- Foreign keys and unique constraints in the SQL script
- Transactions for patient create+assign, upload metadata+audit, release/archive
- In-process scheduled-release job (60s)

### Remaining

- Optional SQL Agent job for HA (Phase 4)
- Patient archival instead of hard delete (documented, not implemented)

### Known Issues

- Audit action enum has no `create`; patient create is logged as `edit`
- Scheduled release only runs while an API process is up

### Verification

- Schema not applied until the developer runs the SQL script

---

## PHASE 3 — RBAC

STATUS: **Server-side checks implemented; frontend nav/routes aligned.**

### Completed

- Role helpers in `lib/rbac.ts`
- Endpoint checks for users, patients, results, archive, audit, dashboard details
- Physician assignment scoping
- Portal ownership checks
- Frontend nav and role routes

### Remaining

- Dedicated automated RBAC test suite (not requested; not claimed)

### Known Issues

- Lab/radiology patient-create is existing behavior, not a new grant
- Super admin can use physician search without assignment restriction

### Verification

- `pnpm typecheck` passed (libs, API, frontend, scripts)
- API `build` passed
- Frontend Vite production build was **not** verified on this Windows host (existing workspace rollup platform overrides omit `@rollup/rollup-win32-x64-msvc`)
- Live unauthorized-access tests require a running API and database

---

## PHASE 4 — FILE STORAGE + BACKUP

STATUS: **Implemented in code. No database migration.**

### Completed

- Canonical `RESULT_STORAGE_ROOT` resolved from repo root / absolute config (not `process.cwd()`)
- Layout `results/<id>/result.<ext>` with legacy basename compatibility
- Magic-byte + extension + MIME validation; 50 MiB default (`RESULT_MAX_FILE_BYTES`)
- Temp write → insert → rename → update `file_name`, with compensation
- Archive/restore remain status-only (files not moved or deleted)
- Read-only `verify-storage`
- Backup/restore/storage documentation
- Storage tests via `pnpm --filter @workspace/scripts run test-storage`

### Remaining

- Stored SHA-256 checksum not added (would require a SQL migration; not executed)
- Production backup jobs are operational, not in-application

### Verification

- See Phase 4 stop report in the implementing change set

