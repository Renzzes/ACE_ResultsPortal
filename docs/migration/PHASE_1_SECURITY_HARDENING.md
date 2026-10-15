# Phase 1 — Security Hardening

## JWT secret

`JWT_SECRET` is required at process start (`getJwtSecret()`).

- Minimum length: 32 characters
- No fallback (`secret`, `development-secret`, `change-me`, etc.)
- The API process exits if the variable is missing or too short

## Admin bootstrap

Duplicate seed paths were removed. The only bootstrap is:

```text
pnpm --filter @workspace/scripts seed-admin
```

Required:

```env
ADMIN_BOOTSTRAP_PASSWORD=<REDACTED>
```

Optional: `ADMIN_BOOTSTRAP_USERNAME` (default `admin`), name, email.

The password is never logged. If the username already exists, the script exits without changes.

## Password handling

Staff passwords and patient access codes are hashed with bcrypt (cost 12). Failed staff logins increment `failed_login_attempts` and lock the account after 5 failures for 15 minutes.

## Access-code hashing

Flow:

1. Generate `ACE-XXXX-XXXX`
2. Show plaintext once to authorized staff (create / regenerate)
3. Store bcrypt `access_code_hash`
4. Portal verify: HIS ID → last name (case-insensitive) → bcrypt compare

Subsequent GET patient responses return `accessCode: null`.

This is a **new** SQL Server database. There are no existing plaintext rows in `ACE_ResultsPortal`. If PostgreSQL data is later imported, hash codes offline before insert; do not store plaintext in SQL Server.

## Rate limiting

`express-rate-limit` is applied to:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/portal/verify`

Window: 15 minutes, 20 requests per IP (`trust proxy` is enabled).

Normal read APIs are not aggressively limited.

## CORS

Production requires `CORS_ORIGIN` as a comma-separated allowlist. `*` is rejected.

Development also allows localhost Vite origins (`8080`, `5173`). Credentials are enabled for the refresh cookie.

## Security headers

Helmet is enabled on the API with:

- default Helmet headers
- **CSP disabled** (`contentSecurityPolicy: false`) because this process is a JSON API, not the SPA host
- `crossOriginResourcePolicy: cross-origin` so browser downloads from the SPA origin can succeed

If the SPA is later served from Express, a dedicated CSP must be designed for that origin. Do not enable a restrictive API CSP that blocks the Vite app.

## File-download security

Routes:

- `GET /api/results/file/:token`
- `GET /api/portal/file/:token`
- `GET /api/physician/file/:token`

Tokens are JWTs (5 minutes) bound to `resultId`, `forType`, and **required** `subjectId`.

Before streaming:

- Staff/physician: reload user, re-run `canAccessResult`
- Portal: result must be released and `result.patientId === subjectId`

`GET /api/results/file/:token` is registered **before** `GET /api/results/:id` so `"file"` is not treated as an id.

File names are resolved with `path.basename` and a resolved-path prefix check against the upload directory.

## Token storage (current model)

| Token | Storage |
| --- | --- |
| Staff access JWT (15m) | `localStorage` (`ace_access_token`) |
| Staff refresh JWT (7d) | `localStorage` **and** httpOnly cookie `ace_refresh_token` (`path=/api/auth`) |
| Portal session (4h) | `localStorage` |

On startup the SPA calls `GET /api/auth/me` and does not treat a locally stored role as authoritative.

**Phase 4/5:** stop returning refresh tokens in JSON, stop storing them in `localStorage`, and rely on the httpOnly cookie only. Access tokens in `localStorage` remain XSS-sensitive until a full cookie session redesign.

## Secret management

- `.env` is gitignored
- `.env.example` uses `<REDACTED>` placeholders
- Pino redacts `Authorization`, cookies, and `password` fields

No first-party hardcoded JWT secrets or admin passwords remain in application code.

## Remaining security issues

1. Access JWT still in `localStorage` (XSS).
2. Refresh token still returned in the login/refresh JSON body for compatibility.
3. Download URLs are bearer-in-path JWTs; they are short-lived and re-authorized, but still sensitive if leaked in logs/referrers.
4. Production should not use `sa`.
5. Helmet CSP is off (API-only). Documented above.
6. Patient portal tokens remain in `localStorage` with no refresh rotation.
