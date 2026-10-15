# Phases 1–3 — Validation record

This document records **what was actually run**. It does not claim tests that were skipped.

SQL DDL was executed **by the developer**, not by Cursor. Application gates used `pnpm --filter @workspace/api-server run start` with root `.env` via `loadRootEnv()`. `NODE_PATH` and `node --env-file` are not the supported startup path.

## Environment

| Item | Value |
| --- | --- |
| Database | **ACE_ResultsPortal** |
| Server | `198.15.0.201:1433` |
| Health | `GET /api/healthz` → HTTP 200 `{"status":"ok"}` |
| Port | `5000` |

## Live synthetic fixture (retained)

Do not treat this as production clinical data.

| Kind | Identifier |
| --- | --- |
| Patient HIS ID | `TEST-ACE-001` |
| Physician username | `test_physician` |
| Admin username | `admin` (`super_admin`) |

Not documented here: passwords, access codes, hashes, JWTs, refresh tokens, download tokens, file bytes.

## Final counts (after E2E gate)

| Table | Count |
| --- | --- |
| users | **2** |
| patients | **1** |
| results | **1** |
| patient_physicians | **1** |
| auth_sessions | **4** |

## Validation matrix

| Test | Expected | Actual | Status | Live / Code-level |
| --- | --- | --- | --- | --- |
| SQL Server connectivity | Connect to ACE_ResultsPortal; `SELECT 1` / `DB_NAME()` | Connected; database name ACE_ResultsPortal | PASS | Live |
| Database schema verification | Tables users, patients, patient_physicians, results, audit_logs; later auth_sessions | Present; FKs as designed | PASS | Live (developer-executed DDL) |
| Admin bootstrap | Single `admin` super_admin, bcrypt, active | Created once; idempotent skip on re-run | PASS | Live |
| API health | GET /api/healthz 200 `{status:ok}` | 200 `{"status":"ok"}` | PASS | Live |
| Packaging / normal start | `pnpm --filter @workspace/api-server run start` without NODE_PATH | After declaring `@azure/identity` and `@azure/core-auth` on api-server | PASS | Live |
| Login | 200; access token; refresh cookie + JSON; role super_admin | 200; issued; httpOnly cookie present | PASS | Live |
| GET /api/auth/me | 200 admin super_admin | 200 | PASS | Live |
| Invalid password | 401; no token | 401 | PASS | Live |
| Refresh | 200; new access token; cookie present | 200 | PASS | Live |
| Logout | 200; cookie cleared | 200 | PASS | Live |
| Refresh-token revocation | Same refresh after logout → 401; `revoked_at` set | 401; session CREATED; revoked_at SET | PASS | Live |
| Unauthenticated API access | 401 on protected GETs; no hash/PII leak | 401 on representative routes | PASS | Live |
| Super_admin authorization | 200 on users, audit, archive, dashboard, patients, results | 200 | PASS | Live |
| Patient creation | POST /patients 201 TEST-ACE-001; accessCode once | 201 | PASS | Live |
| Physician creation | POST /users test_physician role physician active | 201 | PASS | Live |
| Physician assignment | Row in patient_physicians | GET patient showed assignment | PASS | Live |
| Access-code protection | Subsequent GET accessCode null | null | PASS | Live |
| Result upload | 201 laboratory after_physician_review | 201 | PASS | Live |
| Pending result | status pending | pending | PASS | Live |
| Physician pending denial | GET /results/{id} 403; download 403 | 403; list was 200 empty | PASS | Live |
| Portal pending denial | GET /portal/results 200 with 0 rows | 0 rows | PASS | Live |
| Result release | POST .../release immediate → released + dateReleased | 200 released, date set | PASS | Live |
| Physician released access | GET result 200; physician patient results 200 | 200 | PASS | Live |
| Physician download | Download URL + file HTTP 200 | 200 | PASS | Live |
| Portal released access | 200 exactly one released result | 1 row | PASS | Live |
| Portal download | Download authorized | 200 | PASS | Live |
| Archive | PATCH status archived | 200 archived | PASS | Live |
| Portal archived denial | List empty; download denied | 0 rows; download 404 | PASS | Live |
| Restore | POST /archive/{id}/restore → pending | 200 pending | PASS | Live |
| Restored result returns to pending | Not released | pending | PASS | Live |
| Physician restored-result denial | GET /results/{id} 403 | 403 | PASS | Live |
| Portal restored-result denial | 0 portal results | 0 | PASS | Live |
| Audit logging | login, upload, view, download, edit (and related) | Those actions present plus logout, access_denied | PASS | Live |
| Sensitive-data leakage | No hashes/passwords/codes/JWTs in reports or unauth bodies | None observed | PASS | Live |
| medical_records / laboratory / radiology live accounts | Role-specific 403/200 | Not created | — | **Code-level only** |
| Lockout after 5 failures | locked_until / 403 | Inspected in code; not fired against admin | — | **Code-level only** |

### CROSS-PATIENT LIVE TEST: NOT RUN

Only one synthetic patient (`TEST-ACE-001`) was created. No second patient was added. Missing result ID `999999` as physician returned **404** (no record body). That is not a substitute for cross-patient authorization.

## Known limitations

1. Cross-patient authorization was **not live-tested** (one synthetic patient).
2. No live `medical_records` role account was created in these gates.
3. No live `laboratory` or `radiology` role account was created.
4. The frontend hides/redirects some unauthorized pages (`RoleRoute` on users/audit/archive; physician nav). `/patients/new` and `/results/upload` are not role-gated in the SPA router; `/physician/search` is not role-gated in the SPA. **API authorization remains the authoritative boundary.**
5. Refresh tokens are still returned in the login/refresh **JSON body** for compatibility, in addition to the httpOnly cookie `ace_refresh_token`.
6. Actual additional findings from the gates:
   - First API start failed until `@azure/identity` and `@azure/core-auth` were declared on `@workspace/api-server` (esbuild leaves `@azure/*` external). Fixed; normal start works without `NODE_PATH`.
   - Logout previously cleared the cookie without revoking the JWT. Fixed with `dbo.auth_sessions` (developer-executed `002`) and hashed session rows.
   - `POST /patients` 201 may omit `assignedPhysicians` even when `physicianId` was applied; assignment is visible on subsequent GET.
   - Physician `GET /physician/patients/{id}/results` for an assigned patient with only a pending result returns **200 []**, not 403. Direct `GET /api/results/{id}` returns **403**.

Do not invent further issues.

## Phase status

**PHASE 1 — VALIDATED**  
**PHASE 2 — VALIDATED**  
**PHASE 3 — VALIDATED**

### LIVE VALIDATED

SQL Server connectivity; schema presence after developer DDL; env loader; pool; health; packaging/normal start; admin bootstrap; staff login / me / invalid password / refresh / logout / refresh revocation; unauthenticated 401s; super_admin routes; synthetic physician + patient + result workflow (pending denial, release, physician/portal access and download, archive, portal archive denial, restore to pending, post-restore denials); audit presence; no sensitive leakage in gate output.

### CODE-LEVEL VALIDATED

Lockout threshold (5 / 15 minutes); `medical_records` / `laboratory` / `radiology` permission helpers and route guards; full RBAC matrix in `rbac.ts` / `result-access.ts`; portal ID binding and download `subjectId` re-check; blocked hospital database names.

### NOT LIVE TESTED

Cross-patient IDOR; live medical_records / laboratory / radiology users; lockout of the real administrator account (intentionally not triggered).
