/*
  ACE Results Portal — Phase H.5 cutover
  Revoke legacy dbo.auth_sessions rows that have no portal channel.

  DO NOT RUN THIS SCRIPT DURING PHASE H.5.1.
  DO NOT run it on application startup.
  Run it only at the controlled H.5 cutover, after 015_auth_sessions_portal.sql,
  and in the same deployment window as the new session code.

  Target:
    ACE_ResultsPortal.dbo.auth_sessions

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against ShanScheduler.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  Effect:
    Sets revoked_at on rows where portal IS NULL and revoked_at IS NULL.
    Does not remove rows.
    Does not assign those rows to admin, staff, doctor, or patient.
    Does not modify refresh_token_hash, user_id, or clinical tables.

  Rows that already have a portal value are left unchanged.
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

IF COL_LENGTH(N'dbo.auth_sessions', N'portal') IS NULL
BEGIN
  THROW 50002, 'Run 015_auth_sessions_portal.sql before revoking legacy sessions.', 1;
END
GO

UPDATE dbo.auth_sessions
SET revoked_at = SYSDATETIMEOFFSET()
WHERE portal IS NULL
  AND revoked_at IS NULL;
GO

/*
  VERIFY (SELECT-only):

  SELECT
    SUM(CASE WHEN portal IS NULL AND revoked_at IS NULL THEN 1 ELSE 0 END) AS legacy_still_active,
    SUM(CASE WHEN portal IS NULL AND revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS legacy_revoked
  FROM dbo.auth_sessions;

  legacy_still_active must be 0 after this cutover script.
*/
