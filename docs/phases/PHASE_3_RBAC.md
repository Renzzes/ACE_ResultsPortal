# Phase 3 — RBAC / Authorization

Status: **VALIDATED** (API live for `super_admin` + unauthenticated; other roles **code-level** except synthetic `physician` in the E2E gate)

Authorization is enforced on the **API**. Frontend hiding is UX only (`docs/migration/PHASE_3_RBAC_AUTHORIZATION.md`).

Core modules:

- Role helpers: `artifacts/api-server/src/lib/rbac.ts`
- Result object checks: `artifacts/api-server/src/lib/result-access.ts`
- Middleware: `artifacts/api-server/src/middlewares/auth.ts` (`requireAuth`, `requirePortalAuth`, `requireRole`)
- Frontend nav / `RoleRoute`: `artifacts/ace-results-portal/src/components/layout/staff-layout.tsx`, `artifacts/ace-results-portal/src/App.tsx`

Staff JWT `role` values: `super_admin`, `medical_records`, `laboratory`, `radiology`, `physician`.  
Patient portal uses a **separate** JWT (`type: portal`) with `patientId` / `patientHisId` — not a staff role.

## Role matrix

### `super_admin`

| | |
| --- | --- |
| Permitted | User CRUD; patient CRUD; assign physicians; regen access code; all result categories upload/release/archive (PATCH); archive list/restore; audit; dashboard stats and detail charts; physician search routes (not limited to assignments) |
| Prohibited | Portal JWT routes (`requirePortalAuth`) |
| Result category scope | All |
| Patient scope | All |
| Release / archive (PATCH) | All (via `canMutateResult`) |
| Restore / archive list / audit | Yes |

### `medical_records`

| | |
| --- | --- |
| Permitted | Patient CRUD; assign physicians; regen access code; all categories upload/release/archive; archive list/restore; audit; dashboard details |
| Prohibited | User management (`requireRole("super_admin")` on `/users*`) |
| Result / patient scope | All |
| Release / archive / restore / audit | Yes |

**Live `medical_records` account was not created.** Behavior is from code. Archive/audit **were** live-tested as `super_admin` (same `requireRole` / `canListArchive` allowlist).

### `laboratory`

| | |
| --- | --- |
| Permitted | Create patients; regen access code; upload/release/PATCH-archive category **`laboratory` only**; dashboard stats |
| Prohibited | User admin; patient edit/delete; assign physicians; audit; archive list/restore; other categories |
| Patient scope | Any patient record for create/view (no assignment filter) |
| Release / archive PATCH | Own category via `canMutateResult` |
| Restore / audit | No |

**No live laboratory user.** Code-level only.

### `radiology`

Same shape as laboratory, with categories: `radiology`, `ultrasound`, `ct_scan`, `mri`, `ecg`, `echo_2d`, `rehabilitation`, `other`.

**No live radiology user.** Code-level only.

### `physician`

| | |
| --- | --- |
| Permitted | Login; list/get **assigned** patients; view/download **released** results for those patients; `GET /physician/search` and physician result/download routes |
| Prohibited | User admin; patient create/edit/delete; assign; regen access code; upload; release; PATCH archive; archive list/restore; audit; dashboard detail charts |
| Result category scope | All categories **for viewing**, if assigned and released |
| Patient scope | `patient_physicians` only |
| Release / archive / restore / audit | No |

**Live-tested** with synthetic user `test_physician` (pending 403, released 200, restored pending 403).

### Patient portal JWT

| | |
| --- | --- |
| Permitted | `POST /portal/verify` (unauthenticated, rate-limited); `GET /portal/results`; download own **released** results; `POST /portal/logout` |
| Prohibited | All staff routes (`requireAuth` requires `type: access`) |
| Patient scope | Token `patientId` only |
| Results | `status === released` only |

**Live-tested** for TEST-ACE-001: 0 results while pending/archived/restored-pending; 1 result when released; download 200 then 404 after archive.

## Object-level authorization

| Rule | Where |
| --- | --- |
| Physician must be assigned | `patientPhysiciansRepo.findAssignment`; list patients filtered by assigned IDs |
| Result must be released for physician/portal | `canAccessResult`; `GET /results` forces `status=released` for physicians; portal lists `status: released` |
| Portal cannot retarget another patient | List uses `req.portalUser.patientId`; download requires `result.patientId ===` token patient |
| Download tokens bind `subjectId` | File handlers re-check staff `canAccessResult`, portal patient match, or physician assignment |
| API is the security boundary | `requireAuth` / `requireRole` / `can*` / `canAccessResult` |

Unauthenticated staff and portal GETs return **401**. Forbidden authenticated access returns **403**. Missing IDs return **404** without record bodies.

## Frontend vs API

Nav: physicians see Patient Search only; Staff Users is `super_admin`; Audit/Archive are `super_admin` + `medical_records`. `RoleRoute` redirects `/users`, `/audit-logs`, `/archive`.

`/patients/new` and `/results/upload` are session-gated (`ProtectedRoute`) but not role-gated in the router. A physician can open those URLs; the API still returns 403. `/physician/search` is the inverse (any staff can open the page; API `requireRole` returns 403).

## Live vs code-level (Phase 3)

| Area | How validated |
| --- | --- |
| Unauthenticated 401s | Live |
| `super_admin` administrative routes | Live |
| Synthetic physician object-level (one patient) | Live (E2E gate) |
| Portal own-patient pending/released/archived/restored | Live (E2E gate) |
| `medical_records` / `laboratory` / `radiology` accounts | Code-level only |
| Cross-patient IDOR | **NOT RUN** (only one synthetic patient) |
