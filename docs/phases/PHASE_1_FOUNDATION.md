# Phase 1 — Foundation / Security

Status: **VALIDATED**

This phase replaced the previous PostgreSQL + Drizzle + `pg` stack with a SQL Server data layer, a single root environment loader, and staff authentication that can revoke refresh sessions server-side.

## SQL Server migration (from PostgreSQL / Drizzle)

The application no longer uses Drizzle ORM or the `pg` driver for ACE Results Portal data.

| Concern | Implementation |
| --- | --- |
| Driver | `mssql` (Tedious) via `@workspace/db` |
| Queries | Parameterized Transact-SQL in repository modules |
| Schema | Hand-written scripts under `docs/migration/sql/` — **not** auto-migrated at API start |
| Target database | `ACE_ResultsPortal` only |

Existing hospital databases (`LiveDB_ACE`, `CodeGeneratorDB`, `ACE_PatientPortal`, and others listed in `loadDbConfig()`) are **blocked** by name. The API will not start if `DB_DATABASE` is one of those names.

`CREATE DATABASE` and table DDL were **not** run by Cursor. The developer executed them against SQL Server.

## Runtime and repository architecture

| Layer | Location |
| --- | --- |
| Package | `lib/db/` (`@workspace/db`) |
| Pool | `lib/db/src/pool.ts` |
| Config / blocked DB names | `lib/db/src/config.ts` |
| Row mappers | `lib/db/src/mappers.ts` |
| SQL helpers | `lib/db/src/sql-helpers.ts` |
| Repositories | `lib/db/src/repos/users.ts`, `patients.ts`, `patient-physicians.ts`, `results.ts`, `audit-logs.ts`, `auth-sessions.ts` |
| Public exports | `lib/db/src/index.ts` |
| API consumers | `artifacts/api-server/src/routes/*`, `artifacts/api-server/src/lib/*` |

Repositories use `request().input(...)` bound parameters. Multi-step writes (patient create + assign, upload + audit, release, restore) use `withTransaction()` in `lib/db/src/pool.ts`.

The API is bundled with esbuild (`artifacts/api-server/build.mjs`). Tedious is inlined; `@azure/*` is external. Runtime packages `@azure/identity` and `@azure/core-auth` are declared on `@workspace/api-server` so `pnpm --filter @workspace/api-server run start` resolves them without `NODE_PATH`.

## Environment source of truth

| Rule | Detail |
| --- | --- |
| File | Repository root `.env` only |
| Loader | `lib/db/src/load-env.ts` (`loadRootEnv()`) |
| Discovery | Walks to `pnpm-workspace.yaml` from the module path and `cwd` |
| Override | `dotenv` with `override: false` (existing `process.env` wins) |
| Not used | `node --env-file=...`, `.env.local`, `.env.example` as the live file |

API startup (`artifacts/api-server/src/index.ts`) imports `@workspace/db` first and calls `loadRootEnv()` before reading `PORT`, `JWT_SECRET`, or `initDb()`. Admin bootstrap (`scripts/src/seed-admin.ts`) uses the same loader.

Required connectivity variables include `DB_SERVER`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `PORT`, `JWT_SECRET` (≥ 32 characters). Bootstrap uses `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` (password never logged).

## Connection pool

`initDb()` in `lib/db/src/pool.ts` opens a `mssql` `ConnectionPool` and runs `SELECT 1`. `GET /api/healthz` calls `initDb()` again and returns `{ status: "ok" }` or HTTP 503 `{ status: "unhealthy" }`. It does not expose the database name or credentials.

Pool sizing comes from `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_POOL_IDLE_TIMEOUT_MS` (defaults 10 / 0 / 30000). Encrypt / trust-server-certificate flags come from `DB_ENCRYPT` and `DB_TRUST_SERVER_CERTIFICATE`.

## Authentication architecture

Staff auth lives in:

- Routes: `artifacts/api-server/src/routes/auth.ts`
- JWT / bcrypt / cookie names: `artifacts/api-server/src/lib/auth.ts`
- Refresh cookie options: `artifacts/api-server/src/lib/cookies.ts`
- Middleware: `artifacts/api-server/src/middlewares/auth.ts`
- Sessions: `lib/db/src/repos/auth-sessions.ts`

| Token | Type claim | Lifetime | Transport |
| --- | --- | --- | --- |
| Staff access | `access` | 15 minutes | JSON `accessToken` (SPA `localStorage`) |
| Staff refresh | `refresh` | 7 days | JSON `refreshToken` **and** httpOnly cookie `ace_refresh_token` (`path=/api/auth`, `sameSite=lax`) |
| Portal | `portal` | 4 hours | JSON `sessionToken` |
| File download | `download` | 5 minutes | Path `/api/.../file/{token}` |

`JWT_SECRET` is required at process start (`getJwtSecret()`). There is no fallback secret.

`requireAuth` accepts only `type: access`. `requirePortalAuth` accepts only `type: portal`. Portal tokens cannot call staff routes.

### bcrypt

Staff passwords and patient access codes are hashed with **bcrypt cost 12** (`hashPassword`, `hashAccessCode` in `artifacts/api-server/src/lib/auth.ts`). Compare uses `bcrypt.compare`. Plaintext passwords and access codes are not stored.

Failed staff logins increment `failed_login_attempts` and set `locked_until` after **5** failures for **15** minutes (`MAX_ATTEMPTS` / `LOCKOUT_MINUTES` in `auth.ts`). Successful login resets attempts and clears lockout (`usersRepo.recordSuccessfulLogin`).

Admin bootstrap: `pnpm --filter @workspace/scripts seed-admin` (`scripts/src/seed-admin.ts`). Idempotent: skips if the username exists. Live validated username: `admin`, role `super_admin`.

### Refresh hashing and server-side revocation

Refresh JWTs are **never stored in plaintext**. Login writes `SHA-256` hex of the refresh token to `dbo.auth_sessions.refresh_token_hash`.

| Event | Behavior |
| --- | --- |
| Login | Insert session (`expires_at` from JWT `exp`) |
| Refresh | Validate JWT **and** unrevoked, unexpired session; update `last_used_at`; issue a new **access** token; reuse the same refresh token |
| Logout | Revoke matching session (cookie or JSON body). If neither is presented, revoke all active sessions for that user. Clear cookie. |
| After logout | Same refresh token → `POST /api/auth/refresh` → **401** |

Schema for `auth_sessions` is in `docs/migration/sql/002_create_auth_sessions.sql` (developer-executed).

## Rate limiting

`express-rate-limit` (15 minute window, 20 requests) on:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/portal/verify`

Express `trust proxy` is enabled in `artifacts/api-server/src/app.ts`.

## Helmet and CORS

Helmet is enabled with **CSP off** (`contentSecurityPolicy: false`) and `crossOriginResourcePolicy: cross-origin` so the JSON API does not host the SPA CSP and file downloads can be read cross-origin.

CORS uses `CORS_ORIGIN` (comma-separated). Production requires a non-`*` allowlist. Development also allows localhost Vite origins (`8080`, `5173`). `credentials: true` for the refresh cookie.

## Error handling

`artifacts/api-server/src/middlewares/error.ts` maps `AppError` (`artifacts/api-server/src/lib/errors.ts`) to JSON `{ error }`. Unknown errors log via Pino and return HTTP 500 `{ error: "Internal server error" }` without internals. Pino redacts `Authorization`, cookies, and `password` fields (`artifacts/api-server/src/lib/logger.ts`).

## Download token authorization

Short-lived download JWTs bind `resultId`, `forType` (`staff` | `portal` | `physician`), and **`subjectId`**. File routes re-load the result and re-check:

- Staff: `canAccessResult` for `subjectId`
- Portal: `result.patientId === subjectId` and `status === released`
- Physician: assignment of `subjectId` to the result’s patient and released status

Implementation: `signDownloadToken` / `verifyToken` in `artifacts/api-server/src/lib/auth.ts`; stream handlers in `results.ts`, `portal.ts`, `physician.ts`; path checks in `artifacts/api-server/src/lib/storage.ts`.

## Scheduled release worker

`artifacts/api-server/src/lib/scheduled-release.ts` starts from `index.ts` after `initDb()`. It runs immediately and every 60 seconds (`unref`’d interval). It updates due rows (`status=pending`, `release_option=scheduled`, `scheduled_release_date <=` UTC date) to `released` and writes audit rows as user `system`. It is **not** a SQL Agent job. Empty `results` yields a zero-row `UPDATE`. It must not be triggered manually during connectivity-only gates.

## Health

`GET /api/healthz` — `artifacts/api-server/src/routes/health.ts`, mounted at `/api` in `app.ts`. Live: HTTP 200 `{"status":"ok"}`.
