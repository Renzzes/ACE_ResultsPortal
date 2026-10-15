/*
  ACE Results Portal — Phase H.5.1
  Independent portal session columns on dbo.auth_sessions

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script on startup.

  Target:
    ACE_ResultsPortal.dbo.auth_sessions

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against ShanScheduler.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  This migration:
    - Adds nullable public_id CHAR(22)
    - Adds nullable portal VARCHAR(16)
    - Allows portal NULL or one of: admin, staff, doctor, patient
    - Adds unique filtered index IX_auth_sessions_public_id
      on public_id, including revoked_at, expires_at, portal

  portal is the login channel, not an authorization role.
  A staff-channel session may still belong to a super_admin user.

  It does NOT:
    - Recreate or drop dbo.auth_sessions
    - Backfill public_id
    - Assign old rows to a portal
    - Revoke legacy rows (see 015_auth_sessions_revoke_legacy.sql)
    - Modify dbo.users, dbo.results, dbo.result_reviews,
      dbo.patient_departments, dbo.departments, or dbo.role_permissions
    - Touch LiveDB_ACE or ShanScheduler

  Safe to re-run (COL_LENGTH / IF NOT EXISTS guards).

  H.5.2 public_id generation (application code, not this script):
    16 cryptographically random bytes, base64url, exactly 22 characters.
    Node: randomBytes(16).toString("base64url")
    The value is a public session handle. It is not the refresh token
    and it is not the SHA-256 refresh_token_hash. It stays constant
    for the life of the row and is never reused.
*/

USE [ACE_ResultsPortal];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_NAME() <> N'ACE_ResultsPortal'
BEGIN
  THROW 50001, 'This script must run in ACE_ResultsPortal only.', 1;
END
GO

IF OBJECT_ID(N'dbo.auth_sessions', N'U') IS NULL
BEGIN
  THROW 50002, 'dbo.auth_sessions is required before portal session columns.', 1;
END
GO

/* ------------------------------------------------------------------ */
/* public_id — public handle, not the refresh secret                  */
/* ------------------------------------------------------------------ */
IF COL_LENGTH(N'dbo.auth_sessions', N'public_id') IS NULL
BEGIN
  ALTER TABLE dbo.auth_sessions
    ADD public_id CHAR(22) NULL;
END
GO

/* ------------------------------------------------------------------ */
/* portal — authentication channel, not RBAC                          */
/* ------------------------------------------------------------------ */
IF COL_LENGTH(N'dbo.auth_sessions', N'portal') IS NULL
BEGIN
  ALTER TABLE dbo.auth_sessions
    ADD portal VARCHAR(16) NULL;
END
GO

IF COL_LENGTH(N'dbo.auth_sessions', N'portal') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'CK_auth_sessions_portal'
      AND parent_object_id = OBJECT_ID(N'dbo.auth_sessions')
  )
BEGIN
  ALTER TABLE dbo.auth_sessions WITH CHECK
    ADD CONSTRAINT CK_auth_sessions_portal
      CHECK (portal IS NULL OR portal IN (N'admin', N'staff', N'doctor', N'patient'));
END
GO

/* ------------------------------------------------------------------ */
/* IX_auth_sessions_public_id                                         */
/* Unique for non-null public_id. NULLs remain allowed for legacy rows. */
/* INCLUDE supports sid checks on revoked_at, expires_at, and portal. */
/* ------------------------------------------------------------------ */
IF COL_LENGTH(N'dbo.auth_sessions', N'public_id') IS NOT NULL
  AND COL_LENGTH(N'dbo.auth_sessions', N'portal') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_auth_sessions_public_id'
      AND object_id = OBJECT_ID(N'dbo.auth_sessions')
  )
BEGIN
  CREATE UNIQUE INDEX IX_auth_sessions_public_id
    ON dbo.auth_sessions (public_id)
    INCLUDE (revoked_at, expires_at, portal)
    WHERE public_id IS NOT NULL;
END
GO

/*
  ---------------------------------------------------------------------------
  VERIFICATION (SELECT-only)
  ---------------------------------------------------------------------------

  SELECT DB_NAME() AS CurrentDatabase;

  SELECT c.name, t.name AS type_name, c.max_length, c.is_nullable
  FROM sys.columns c
  INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
  WHERE c.object_id = OBJECT_ID(N'dbo.auth_sessions')
    AND c.name IN (N'public_id', N'portal');

  SELECT i.name, i.is_unique, i.has_filter, i.filter_definition
  FROM sys.indexes i
  WHERE i.object_id = OBJECT_ID(N'dbo.auth_sessions')
    AND i.name = N'IX_auth_sessions_public_id';

  SELECT COUNT(*) AS total_rows,
         SUM(CASE WHEN portal IS NULL THEN 1 ELSE 0 END) AS null_portal_rows,
         SUM(CASE WHEN public_id IS NOT NULL THEN 1 ELSE 0 END) AS public_id_rows
  FROM dbo.auth_sessions;
*/
