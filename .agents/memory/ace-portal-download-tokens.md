---
name: ACE Results Portal — download token audience binding
description: Signed file-download JWTs carry a forType audience (+ subjectId for physician); every file-serving endpoint must verify its own audience and re-check authorization at serve time.
---

# Download token audience + serve-time re-validation

Signed download tokens (`signDownloadToken`) carry `{ resultId, forType, subjectId?, type: "download" }`, expire in 5m.

- `forType` is the audience: `"staff" | "portal" | "physician"`.
- `subjectId` binds the token to the requesting user (physician download passes the physician's userId).

**Rule:** every `*/file/:token` endpoint MUST verify `payload.type === "download"` AND `payload.forType === <its own channel>`. Without the audience check, a link issued for one channel can be replayed on another (cross-context token confusion).

**Rule:** file endpoints must re-check authorization at serve time, not just trust the token. The physician file endpoint re-verifies the result is still `released` and the patient is still assigned to `subjectId` (patient_physicians) before streaming.

**Why:** a 5-minute token outlives a permission change (un-assignment, un-release). Re-checking at serve time closes that window. Audience binding prevents staff/portal/physician tokens from being used interchangeably.

**How to apply:** when adding any new file-download channel, give it a distinct `forType`, pass a `subjectId` if the resource is user-scoped, and replicate the audience + serve-time authorization checks in the serving route.
