# ACE Results Portal

Hospital results and care portal for **ACE Medical Center Cebu**. Staff upload and manage diagnostic result documents; physicians review and comment; patients unlock and view their own results through a secure portal. The system also supports messaging, prescriptions, notifications, and hospital-identity verification against a read-only HIS database connection.

This repository is the application **source monorepo**. It is not a dump of production secrets, patient files, or database backups.

**Release tip documented for first public publication:** commit `84103a7` (`release/doc-access-codes`) — document-level result access codes for patient portal unlock.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Staff / Doctor / Patient / Admin portals)         │
│  artifacts/ace-results-portal  (React + Vite)               │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS / HTTP API
┌───────────────────────────▼─────────────────────────────────┐
│  artifacts/api-server  (Express API)                        │
│  Auth sessions · RBAC · results · messaging · email         │
└─────────────┬───────────────────────────────┬───────────────┘
              │                               │
              ▼                               ▼
   SQL Server portal DB              Read-only HIS DB
   (ACE_ResultsPortal)               (configured separately)
              │
              ▼
   RESULT_STORAGE_ROOT  (PDF / document files on disk)
```

| Package / path | Role |
| --- | --- |
| `artifacts/ace-results-portal` | Front-end SPA (Vite + React) |
| `artifacts/api-server` | Back-end API (Express) |
| `lib/db` | SQL Server access, repositories, env loading |
| `lib/api-client-react`, `lib/api-zod` | Shared API client / schemas |
| `scripts/` | Build, deploy helpers, validation, tests |
| `docs/migration/sql/` | Manual SQL migrations (run by DBA only) |
| `ACERPTS_OneClick.bat` | Windows production assemble / sync helper (use with care) |

**pnpm workspace** (`pnpm-workspace.yaml`) ties `artifacts/*`, `lib/*`, and `scripts` together.

---

## Prerequisites

- **Node.js** 20+ (production builds on this project have used Node 24.x)
- **pnpm** (required — `npm` / `yarn` install is blocked by `preinstall`)
- **SQL Server** instance and a dedicated portal database (do **not** point `DB_DATABASE` at hospital HIS databases such as `LiveDB_ACE`)
- Optional: SMTP credentials for portal email features
- Optional: separate read-only HIS SQL login for hospital verification features

---

## Local development

```bash
# From repository root
pnpm install

# Copy example env and edit locally (never commit real secrets)
cp .env.example .env

# Start API + Vite portal in parallel
pnpm dev
```

Typical local ports (override via `.env`):

| Service | Default |
| --- | --- |
| API (`PORT` / `HOST`) | Often `5000` in source layouts; production commonly uses `3003` |
| Vite portal | See `VITE_PORT` / portal package config |

Run typechecking:

```bash
pnpm run typecheck
```

Workspace scripts of interest:

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Parallel API + portal development servers |
| `pnpm run build` | Typecheck + package builds |
| `pnpm run build:production` | Stamp version, build portal + API, assemble `dist/` |
| `pnpm run stamp:version` | Write build identity into `version.json` |
| `pnpm run verify` | Verify assembled production build |
| `pnpm run typecheck` | TypeScript project references + package checks |

---

## Production build

```bash
pnpm install --frozen-lockfile   # preferred in CI / release machines
pnpm run build:production
pnpm run verify
```

`build:production` will:

1. Stamp `version.json` with git commit / branch metadata  
2. Build the Vite client  
3. Build the API server bundle  
4. Assemble a deployable tree under `dist/` via `scripts/assemble-dist.mjs`

Deploy the assembled runtime (server entry + client assets + production `node_modules` as required by your packaging process) to the host application directory. On Windows FILESERVER deployments this is typically orchestrated with `ACERPTS_OneClick.bat` / sync scripts — **review those scripts before use**; they can stop services and replace runtime files.

---

## Configuration

All runtime configuration is via environment variables loaded from `.env` at the application root (see `lib/db` env loader). Use **`.env.example`** as the template.

**Rules:**

- Never commit `.env`, `.env.production`, or real credentials.
- `DB_DATABASE` must be the portal database (e.g. `ACE_ResultsPortal`), never a blocked hospital system database name.
- HIS access must use dedicated `HIS_DB_*` credentials (fail-closed; no silent fallback to portal SQL credentials).
- `RESULT_STORAGE_ROOT` must be a dedicated directory for result PDFs — do not commit that directory’s contents.

See `.env.example` for the full name list and safe placeholders.

### SQL migrations

Migrations under `docs/migration/sql/` are **manual**. They hard-assert the portal database name in production scripts. Apply only with DBA review; never auto-run against HIS databases such as `LiveDB_ACE`.

---

## Deployment considerations

1. **Secrets:** Inject via a protected `.env` or secret store on the host; not via git.  
2. **Storage:** Persist `RESULT_STORAGE_ROOT` across releases; back it up separately from the app tree.  
3. **Process manager:** Production Windows installs commonly use a scheduled task launcher (`run-acerpts-service.cmd`) that restarts Node on exit.  
4. **TLS:** Often terminated at a reverse proxy / CDN (e.g. public HTTPS to the hospital hostname) while Node listens on HTTP locally.  
5. **CORS:** Set `CORS_ORIGIN` to the exact public and LAN origins you serve.  
6. **Health:** After start, verify `GET /healthz` returns HTTP 200.  
7. **Release identity:** Confirm `version.json` (or health metadata) matches the intended git commit before calling a cutover complete.

This open-source publication does **not** include production host paths, internal IPs, or live credentials.

---

## Security & privacy

- Patient result PDFs and backups must stay outside git (see `.gitignore`).
- Do not publish HIS handoff documents that contain credentials.
- Prefer least-privilege SQL logins for portal and HIS connections.
- Rotate any credential that may have appeared in local untracked files before they were ignored.

---

## License

MIT (see `package.json`).

---

## Disclaimer

This software handles clinical documents and personal data. Operators are responsible for HIPAA/privacy compliance, access control, backup, and change control appropriate to their facility. The authors and ACE Medical Center Cebu provide the software as-is within the stated license.
