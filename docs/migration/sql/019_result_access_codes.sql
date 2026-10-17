/*
  ACE Results Portal — Per-document (result) access codes

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script on startup.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against ShanScheduler.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  This migration:
    - Adds per-result access-code credential columns on dbo.results
    - Allows dbo.patients.access_code_hash to be NULL (patient-level unlock retired)
    - Does NOT copy existing patient-level codes onto results (legacy docs stay locked
      until an authorized per-document issuance/regeneration)

  Rollback (manual):
    ALTER TABLE dbo.results DROP CONSTRAINT CK_results_access_code_email_status;
    ALTER TABLE dbo.results DROP COLUMN access_code_email_status;
    ALTER TABLE dbo.results DROP COLUMN access_code_emailed_at;
    ALTER TABLE dbo.results DROP COLUMN access_code_issued_at;
    ALTER TABLE dbo.results DROP COLUMN access_code_encrypted;
    ALTER TABLE dbo.results DROP COLUMN access_code_hash;
    -- Re-tighten patients.access_code_hash only after backfilling non-null values.

  Safe to re-run (IF COL_LENGTH / IF EXISTS guards).
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

IF OBJECT_ID(N'dbo.results', N'U') IS NULL
BEGIN
  THROW 50002, 'dbo.results is required. Run 001_create_database_and_schema.sql first.', 1;
END
GO

IF OBJECT_ID(N'dbo.patients', N'U') IS NULL
BEGIN
  THROW 50003, 'dbo.patients is required. Run 001_create_database_and_schema.sql first.', 1;
END
GO

/* -------------------------------------------------------------------------- */
/* dbo.results — document-level credentials                                   */
/* -------------------------------------------------------------------------- */

IF COL_LENGTH(N'dbo.results', N'access_code_hash') IS NULL
BEGIN
  ALTER TABLE dbo.results ADD access_code_hash NVARCHAR(255) NULL;
END
GO

IF COL_LENGTH(N'dbo.results', N'access_code_encrypted') IS NULL
BEGIN
  ALTER TABLE dbo.results ADD access_code_encrypted NVARCHAR(512) NULL;
END
GO

IF COL_LENGTH(N'dbo.results', N'access_code_issued_at') IS NULL
BEGIN
  ALTER TABLE dbo.results ADD access_code_issued_at DATETIMEOFFSET(7) NULL;
END
GO

IF COL_LENGTH(N'dbo.results', N'access_code_emailed_at') IS NULL
BEGIN
  ALTER TABLE dbo.results ADD access_code_emailed_at DATETIMEOFFSET(7) NULL;
END
GO

IF COL_LENGTH(N'dbo.results', N'access_code_email_status') IS NULL
BEGIN
  ALTER TABLE dbo.results ADD access_code_email_status NVARCHAR(32) NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_results_access_code_email_status'
    AND parent_object_id = OBJECT_ID(N'dbo.results')
)
BEGIN
  ALTER TABLE dbo.results WITH NOCHECK
    ADD CONSTRAINT CK_results_access_code_email_status CHECK (
      access_code_email_status IS NULL
      OR access_code_email_status IN (N'none', N'accepted', N'failed')
    );
END
GO

/* -------------------------------------------------------------------------- */
/* dbo.patients — patient-level unlock code no longer required                */
/* -------------------------------------------------------------------------- */

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.patients')
    AND name = N'access_code_hash'
    AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.patients ALTER COLUMN access_code_hash NVARCHAR(255) NULL;
END
GO
