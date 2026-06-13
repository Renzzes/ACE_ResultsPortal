---
name: ACE Results Portal — auth token refresh
description: Why all authenticated frontend calls must go through customFetch, and how silent 401 refresh works.
---

# Auth: short-lived access token + silent refresh

The staff access token (`ace_access_token`) is short-lived (15m); the refresh token
(`ace_refresh_token`) lasts 7d. Refresh is centralized: the shared HTTP client
(`lib/api-client-react/src/custom-fetch.ts`) exposes `setUnauthorizedHandler`, wired
in `App.tsx` to POST `/api/auth/refresh` and retry the original request once with a
fresh token. A single in-flight refresh promise dedupes concurrent 401s.

**Rule:** every authenticated staff call must go through `customFetch` (or a generated
hook that uses it) — never raw `fetch` with `Authorization: Bearer ${auth.token}`.

**Why:** raw fetch bypasses the 401 refresh path AND uses `auth.token` from React
state, which goes stale after a refresh (refresh only updates localStorage). Both
cause silent 401s after 15 min (symptom: "Failed to create patient", physician
search returns nothing). `customFetch` reads the token fresh from the getter at call
time, so it always sends the current token and auto-refreshes.

**How to apply:** when adding a frontend call to a custom (non-generated) endpoint,
import `customFetch` from `@workspace/api-client-react` and pass the URL with no auth
header — the configured token getter attaches it. The patient portal is excluded:
its token (`ace_portal_token`, 4h) has no refresh flow, so the handler no-ops on
`/portal` routes.
