# Result file storage

Diagnostic result **binaries** live on the filesystem. SQL Server (`ACE_ResultsPortal`) stores metadata, authorization, status, category, release, and audit data. Result PDFs/images are **not** stored in SQL Server.

## Storage root

One canonical root, configured by:

```
RESULT_STORAGE_ROOT=<absolute or repo-relative directory>
```

Resolution:

1. Load `<repo-root>/.env` (same contract as the database).
2. If `RESULT_STORAGE_ROOT` is set:
   - absolute value is used as-is after `path.resolve`
   - relative value is resolved against the **repository root**, not `process.cwd()`
3. If unset, the default is:

```
<repo-root>/artifacts/api-server/uploads
```

That default preserves files uploaded before Phase 4 (including the synthetic fixture). It is still an absolute path derived from the repository root.

`process.cwd()` is **not** the storage-root contract. The same directory is used when the API CWD is `artifacts/api-server`, after a production build (`dist/index.mjs`), and after process restart.

Do not hard-code a developer workstation path in source. Set `RESULT_STORAGE_ROOT` in `.env` for production (a dedicated volume is recommended).

The storage directory is gitignored and must not be committed.

## Directory layout

```
<RESULT_STORAGE_ROOT>/
  tmp/
    <uuid>.pdf|jpeg|png          incoming uploads (not client-named)
  results/
    <result-id>/
      result.pdf|jpeg|png        final immutable object
  <legacy-basename>              pre-Phase 4 files (basename only)
```

New uploads are addressed by **result id**, not by patient name, physician name, or original filename.

Legacy rows keep `file_name` values such as `1786704433934-853475370.pdf` at the storage root. Downloads resolve both layouts.

The client never controls the final filesystem path.

## Filename rules

| Field | Source | Used as filesystem path? |
| --- | --- | --- |
| Stored object | Application (`results/<id>/result.<type>` or legacy generated basename) | Yes |
| `original_file_name` | Sanitized client filename (basename only) | No — metadata / Content-Disposition only |
| Patient / physician names | Database | No |

Rejected stored keys:

- `..` / path traversal
- absolute Windows paths
- UNC paths (`\\server\share`, `//server/share`)
- drive-letter paths (`C:\`, `D:/`)
- null bytes
- extra path separators / `:` in stored keys

If a stored path exists, it is resolved with `realpath` and must remain inside the storage root (symlink escape is rejected).

## Supported file types

Unchanged from the previous upload contract. Phase 4 does **not** broaden types.

| Type | Extension | MIME | Magic bytes |
| --- | --- | --- | --- |
| PDF | `.pdf` | `application/pdf` | `%PDF` (`25 50 44 46`) |
| JPEG | `.jpg` / `.jpeg` | `image/jpeg` or `image/jpg` | `FF D8 FF` |
| PNG | `.png` | `image/png` | `89 50 4E 47 0D 0A 1A 0A` |

Extension, client MIME, and magic bytes must agree. `Content-Type` alone is not trusted.

## File-size limit

Default maximum: **50 MiB** (`52428800` bytes). This was the existing multer limit.

Override with:

```
RESULT_MAX_FILE_BYTES=52428800
```

Empty files are rejected.

## Upload flow

1. Authenticate and authorize the uploader (existing RBAC / category rules).
2. Multer writes a UUID-named file under `<root>/tmp/` (application-generated name).
3. Re-validate size, extension, MIME, and magic bytes.
4. Insert `dbo.results` with `file_name = tmp/<uuid>.<ext>` (metadata only; not a complete result yet).
5. Rename the temp object to `results/<id>/result.<ext>` (overwrite is refused).
6. Update `file_name` to the final relative key.
7. Write the upload audit row.

Compensation (filesystem and SQL Server are **not** a single atomic transaction):

- Validation / insert failure → delete the temp file; no result row.
- Rename or `file_name` update failure → delete the result row just created, delete the temp file, delete the final object if it was created. The row is not left looking valid without a file.
- Crash between insert and rename → `verify-storage` reports CASE A or a `tmp/` object still referenced by `file_name`.

## Download flow

A filesystem path is never sufficient.

```
authentication
  → authorization
  → result ownership / department / assignment scope
  → release / status rules
  → file existence
  → stream file
```

Clients receive `/api/.../file/<download-token>` only. Responses do not include `C:\`, `D:\`, UNC, or `RESULT_STORAGE_ROOT` paths. `fileName` in JSON is the **relative storage key**, not an OS path.

| Actor | Download rule (unchanged from Phase 3) |
| --- | --- |
| Physician | Assigned **and** `released` |
| Portal | Own patient **and** `released` |
| `super_admin` / `medical_records` | Existing RBAC (status does not block staff access) |
| Laboratory / radiology | Department category scope |

Pending and archived results remain denied for physician and portal.

## Archive behavior

`PATCH /api/results/{id}` with `{ "status": "archived" }` changes **database status only**.

The physical file is not moved, copied, or deleted. Archive is not backup and is not delete.

## Restore behavior

`POST /api/archive/{id}/restore` sets status back to **`pending`**.

The physical file is not recreated or moved. Restore is not a disaster-recovery restore of storage. Physician and portal downloads remain denied until the result is released again.

## Orphan detection

Read-only diagnostic:

```
pnpm --filter @workspace/scripts run verify-storage
```

| Case | Meaning |
| --- | --- |
| A | `dbo.results` row exists; file at the stored key is missing |
| B | File exists under the storage root; no matching result row |

The command never deletes files or rows.

## Security model

- Storage key is generated by the application.
- Path traversal and absolute/UNC paths are rejected.
- Download re-checks authz on the token subject before `createReadStream`.
- Result binaries stay on disk; SQL Server stays metadata + authorization.

## Backup relationship

See [../backup/README.md](../backup/README.md). Database backup and file-storage backup are both required. Backup means **copy/preserve**, never move-and-delete of the live store.
