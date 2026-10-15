# Portal email (Gmail) and results access codes

This document covers Gmail SMTP setup for the ACE Results Portal and the recent
patient access-code / forgot-password behavior.

## What email is used for

| Feature | Who triggers it | What is sent |
|---------|-----------------|--------------|
| Forgot password | Patient on `/recover?as=patient` | 6-digit OTP to the patient’s portal email |
| Issue & Email New Code | Admin → Patient accounts | Brand-new results access code |
| (Related) Forgot Access Code | Patient unlock dialog | Does **not** email immediately — notifies admins; staff issues/emails a new code |

Implementation: Nodemailer in `artifacts/api-server/src/lib/portal-email.ts`.

---

## Gmail SMTP setup

### 1. Google account prerequisites

1. Use a dedicated sender mailbox (example used in this project: `support.acemcc@gmail.com`).
2. Turn on **2-Step Verification** for that Google account.
3. Create an **App Password** (not the normal Gmail password):  
   [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)  
   App name example: `ACE Portal` → copy the 16-character password.

### 2. Environment variables (repo-root `.env`)

Add (or confirm) these in **`d:\ace-results-portal-source\.env`** and **save the file to disk** (`Ctrl+S`).  
Unsaved editor buffers are not loaded by the API.

```env
# Gmail SMTP (forgot password OTP + access code emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.sender@gmail.com
SMTP_PASS="xxxx xxxx xxxx xxxx"
PORTAL_EMAIL_FROM="ACE Medical Center Cebu <your.sender@gmail.com>"
```

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` | Required for “email configured”. Use `smtp.gmail.com`. |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (SSL). |
| `SMTP_USER` | Full Gmail address. |
| `SMTP_PASS` | **Google App Password** only. Quote if it contains spaces. |
| `PORTAL_EMAIL_FROM` | From header shown to recipients. |

Loaded by `loadRootEnv()` from `@workspace/db` (reads `<repo-root>/.env`).  
`isPortalEmailConfigured()` is true when `SMTP_HOST` is set.

**Never commit `.env` or paste App Passwords into chat/tickets.**

### 3. Restart the API after changing `.env`

The API process reads env at startup (dev = build once + start; no hot reload for env):

```bash
npx --yes kill-port 8080 5000
pnpm run dev
```

Frontend: `http://localhost:8080` · API: port `5000`.

### 4. Verify

1. Admin → Patient accounts → open a patient with a portal email → **Issue & Email New Code**.
2. Patient Forgot Password → complete HIS verify → OTP email arrives (check Spam).
3. API logs: `portal_email_sent` on success, `portal_email_send_failed` / `portal_email_not_configured` on failure.

### Common failures

| Symptom | Cause |
|---------|--------|
| `Email delivery is not configured` (503) | `SMTP_HOST` missing from **on-disk** `.env`, or API not restarted |
| `This patient has no portal email on file` (400) | Missing/invalid portal email, or raw DB email not resolved (see below) |
| Gmail `535` / Invalid login | Used normal password instead of App Password; or 2SV off |
| Medications 503 | Unrelated — prescriptions schema may be missing (`011_create_prescriptions.sql`) |

---

## Auth model (password vs access code)

| Credential | Purpose |
|------------|---------|
| Hospital Patient ID + Last Name + **Password** | Portal login (`POST /api/portal/login`) |
| **Access code** | Unlock / view / download **Results** only |

- Access codes **do not expire on a timer**.
- Unlock is remembered per Hospital Patient ID in **localStorage** (survives logout).
- Codes stop working only when staff **issues a replacement** (forgot-access-code flow).

---

## Recent behavior changes

### Patient side

- Login uses **password**, not access code.
- Results unlock dialog: reminder that the code does not expire; **Forgot Access Code** requests staff help (sets `patients.access_code_requested_at`, notifies admins).
- Stored unlock cleared when the API returns **403** on results (code was replaced).
- Logout does **not** clear the stored access code.

Key UI/helpers:

- `artifacts/ace-results-portal/src/lib/portal-results-access.ts`
- `artifacts/ace-results-portal/src/components/portal/results-unlock-dialog.tsx`
- `artifacts/ace-results-portal/src/pages/portal/results.tsx`
- `artifacts/ace-results-portal/src/pages/portal/dashboard.tsx`

### Admin side

- Patient accounts dialog:
  - **Issue New Access Code** — always generates a **new** hash; previous code invalid.
  - **Issue & Email New Code** — always generates a **new** code, emails it, never re-sends a previously shown code.
- Column **Access code request** reflects pending patient forgot-code requests.
- Migration: `docs/migration/sql/012_patient_access_code_request.sql` (`access_code_requested_at`).

Key routes:

- `POST /api/patients/:id/regenerate-access-code`
- `POST /api/patients/:id/email-access-code` (issues new code + email)
- `POST /api/portal/request-access-code` (patient request → admin notify)

UI: `artifacts/ace-results-portal/src/pages/admin/patients.tsx`

### Portal email resolution (important fix)

Some patient rows store contact as `HIS email` + newline + **portal email**.  
List/detail APIs already showed the portal part; email send previously validated the **raw** string and failed with “no portal email on file.”

Shared helper: `resolvePatientPortalEmail()` in  
`artifacts/api-server/src/lib/formatters.ts`

Used by:

- Admin issue-and-email
- Forgot-password recovery (`portal-recovery.ts`)
- `formatPatient()` responses

### Gmail integration notes from rollout

1. App Password created after enabling 2-Step Verification.
2. SMTP block added to `.env` — must be **saved to disk** (unsaved Cursor buffer caused the first “not configured” 503).
3. API restarted so Nodemailer picked up `SMTP_*`.

---

## Quick test checklist

- [ ] `.env` on disk contains `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `PORTAL_EMAIL_FROM`
- [ ] API restarted after env change
- [ ] Patient has a resolvable portal email (e.g. `aceinformationtechdept@gmail.com`)
- [ ] Issue & Email New Code → inbox receives code; old code no longer unlocks Results
- [ ] Forgot Password → OTP email arrives; new password signs in
- [ ] Patient unlock after replacement requires the **new** code
