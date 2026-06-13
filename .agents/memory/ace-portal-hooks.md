---
name: ACE Portal mutation hook patterns
description: Generated Orval mutation hook call signatures — all body params are wrapped in a `data` key.
---

## Rule
All generated Orval mutation hooks require the request body wrapped in `{ data: ... }`:

```ts
// CORRECT
createPatient.mutate({ data: { patientHisId, lastName, ... } })
releaseResult.mutate({ id, data: { releaseOption: "immediate" } })
archiveResult.mutate({ id, data: { status: "archived" } })
changePassword.mutate({ data: { currentPassword, newPassword } })
```

ID-only mutations (delete, regenerate, restore) take `{ id }` directly with no `data` wrapper.

## Auth token wiring — CRITICAL
`setAuthTokenGetter` from `@workspace/api-client-react` MUST be called once at app startup (in App.tsx, before any component renders) so that the custom fetch attaches `Authorization: Bearer <token>` to every request. Without it, every API call returns 401.

```ts
// App.tsx — top level, outside any component
import { setAuthTokenGetter } from "@workspace/api-client-react";
setAuthTokenGetter(() => localStorage.getItem("ace_access_token"));
```

The comment in custom-fetch.ts says "should never be used in web apps where session cookies are used" — that comment is misleading for this JWT-based setup. **Always wire it for this project.**

## Archive support
`ResultUpdate` schema now includes `status: enum [pending, released, archived]`.
Backend PATCH `/api/results/:id` applies `status` from `parsed.data.status`.

**Why:** Orval generates hooks with `{data: BodyType<Schema>}` shape for POST/PATCH bodies. Passing the body fields at the top level causes TS2353 errors.

**How to apply:** Any time you call a generated mutation hook for a POST/PATCH operation, wrap the body in `data: { ... }`.
