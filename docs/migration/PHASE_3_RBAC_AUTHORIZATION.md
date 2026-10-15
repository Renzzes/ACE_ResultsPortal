# Phase 3 — RBAC and Authorization

Authorization is enforced on the API. Frontend hiding is UX only.

## Roles

Staff JWT roles:

- `super_admin`
- `medical_records`
- `laboratory`
- `radiology`
- `physician`

Patient portal uses a separate JWT (`type: portal`) with `patientId` / `patientHisId`. Portal tokens cannot call staff routes (`requireAuth` requires `type: access`).

## Verified matrix (from code)

| Operation | Super Admin | Medical Records | Laboratory | Radiology | Physician | Patient portal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Login | YES | YES | YES | YES | YES | Portal verify |
| User management | YES | NO | NO | NO | NO | NO |
| Patient create | YES | YES | YES | YES | NO | NO |
| Patient edit / delete | YES | YES | NO | NO | NO | NO |
| Assign physician | YES | YES | NO | NO | NO | NO |
| Regen access code | YES | YES | YES | YES | NO | NO |
| Upload laboratory | YES | YES | YES | NO | NO | NO |
| Upload radiology (+ imaging categories) | YES | YES | NO | YES | NO | NO |
| Release / archive (own department) | YES | YES | category | category | NO | NO |
| Restore archive | YES | YES | NO | NO | NO | NO |
| List archive | YES | YES | NO | NO | NO | NO |
| View results | all | all | category | category | assigned **released** only | own **released** only |
| Download | same as view | same | same | same | assigned released | own released |
| Audit logs | YES | YES | NO | NO | NO | NO |
| Dashboard stats | YES | YES | YES | YES | YES | NO |
| Dashboard detail charts | YES | YES | NO | NO | NO | NO |

Laboratory categories: `laboratory`.

Radiology categories: `radiology`, `ultrasound`, `ct_scan`, `mri`, `ecg`, `echo_2d`, `rehabilitation`, `other`.

## Ambiguities (not guessed into new features)

- Lab/radiology **may create patients** (existing product behavior). They **may not** edit/delete patients or assign physicians.
- Super admin can use physician search routes (`physician` **or** `super_admin`). Super admin is not limited to assigned patients on those routes.
- There is no separate “department” column on users; department is the role.

## Endpoint authorization

Every staff route uses `requireAuth` except login, refresh, health, portal verify, and file-token downloads (re-authorized via token `subjectId`).

Resource checks:

- Physicians cannot load unassigned patients (`GET /patients/:id`, results, physicians list).
- Portal download and file stream bind `patientId` from the token; request IDs cannot retarget another patient.
- Result mutate/release/archive also require department scope (`canMutateResult`).

## Patient portal

A portal session can list and download **only** that patient’s **released** results. It cannot change patient ownership, assignments, or release status.

## Archive

`GET /api/archive` and `POST /api/archive/:id/restore` require `super_admin` or `medical_records`.

## Audit

`GET /api/audit-logs` requires `super_admin` or `medical_records`.

## Frontend UX

- Nav: physicians see patient search; user admin is super_admin-only; audit/archive are admin + medical records.
- Routes `/users`, `/audit-logs`, `/archive` redirect unauthorized staff to `/dashboard`.
- Upload/release/archive buttons hidden for physicians.
- Access codes shown only immediately after create/regenerate.
- Bootstrap: `GET /api/auth/me` before rendering protected pages.

The API remains the security boundary.
