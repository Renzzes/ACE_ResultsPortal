# ACE Results Portal — Phase map

This folder documents Phases 1–3 as **implemented and validated**. It is not a design proposal.

Related migration notes live in `docs/migration/`. Schema scripts live in `docs/migration/sql/`. Storage and backup live in `docs/storage/` and `docs/backup/`.

| Phase | Scope | Status |
| --- | --- | --- |
| **1** | Foundation / Security | **VALIDATED** — [PHASE_1_FOUNDATION.md](./PHASE_1_FOUNDATION.md) |
| **2** | SQL Server / Data layer | **VALIDATED** — [PHASE_2_DATABASE.md](./PHASE_2_DATABASE.md) |
| **3** | RBAC / Authorization | **VALIDATED** — [PHASE_3_RBAC.md](./PHASE_3_RBAC.md) |
| **1–3** | Live + code-level validation record | [PHASE_1_3_VALIDATION.md](./PHASE_1_3_VALIDATION.md) |
| **4** | File storage + backup | Implemented — [../storage/README.md](../storage/README.md), [../backup/README.md](../backup/README.md). Independently validate before Phase 5. |

## What was validated

- Application database: **ACE_ResultsPortal** on SQL Server (`198.15.0.201:1433`)
- API process: `pnpm --filter @workspace/api-server run start` (no `NODE_PATH`, no `node --env-file`)
- Health: `GET /api/healthz` → HTTP 200 `{"status":"ok"}`
- Staff authentication, refresh-session revocation, synthetic end-to-end workflow

SQL that created the database and `auth_sessions` was **executed manually by the developer**, not by Cursor.

## What was not live-tested

- Cross-patient object authorization (only one synthetic patient)
- Live `medical_records`, `laboratory`, and `radiology` role accounts
- Those areas were verified at **code level** only. See [PHASE_1_3_VALIDATION.md](./PHASE_1_3_VALIDATION.md).
