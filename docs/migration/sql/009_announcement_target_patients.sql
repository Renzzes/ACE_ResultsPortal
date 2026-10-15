/*
  ACE Results Portal — Phase 6D-2
  Announcement audience: All Patients

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  Why this is required:
    dbo.announcement_targets.CK_announcement_targets_type currently allows only:
      all_staff | all_physicians | department
    Patient Portal announcement targeting requires:
      all_patients

  This migration:
    - Drops CK_announcement_targets_type
    - Recreates it including N'all_patients'

  It does NOT:
    - Create tables
    - Create columns
    - Modify notifications rows
    - Touch LiveDB_ACE
    - Backfill patients or portal users

  Safe to re-run (checks existing constraint definition).
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

IF OBJECT_ID(N'dbo.announcement_targets', N'U') IS NULL
BEGIN
  THROW 50002, 'dbo.announcement_targets is missing. Run 007 first.', 1;
END
GO

DECLARE @definition NVARCHAR(MAX) = (
  SELECT cc.definition
  FROM sys.check_constraints cc
  WHERE cc.name = N'CK_announcement_targets_type'
    AND cc.parent_object_id = OBJECT_ID(N'dbo.announcement_targets')
);

IF @definition IS NULL
   OR CHARINDEX(N'all_patients', @definition) = 0
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'CK_announcement_targets_type'
      AND parent_object_id = OBJECT_ID(N'dbo.announcement_targets')
  )
  BEGIN
    ALTER TABLE dbo.announcement_targets
      DROP CONSTRAINT CK_announcement_targets_type;
  END;

  ALTER TABLE dbo.announcement_targets
    ADD CONSTRAINT CK_announcement_targets_type
    CHECK (target_type IN (
      N'all_staff',
      N'all_physicians',
      N'department',
      N'all_patients'
    ));
END
GO
