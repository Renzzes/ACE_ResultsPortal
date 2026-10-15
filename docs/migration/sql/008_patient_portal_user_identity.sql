/*
  ACE Results Portal — Phase 6D-1
  Patient Portal User Identity Normalization

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  This migration:
    - Adds dbo.patients.portal_user_id (nullable)
    - Adds FK_patients_portal_user → dbo.users(id) ON DELETE NO ACTION
    - Adds filtered unique index UX_patients_portal_user_id
      (one portal user → one patient; multiple NULLs allowed)

  It does NOT:
    - Backfill portal users for existing patients
    - Modify created_by_id
    - Drop / truncate / rewrite patient or user data
    - Touch notifications, messaging, or LiveDB_ACE

  Safe to re-run (IF NOT EXISTS / COL_LENGTH guards).
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

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  THROW 50002, 'dbo.users is required before portal identity normalization.', 1;
END
GO

IF OBJECT_ID(N'dbo.patients', N'U') IS NULL
BEGIN
  THROW 50003, 'dbo.patients is required before portal identity normalization.', 1;
END
GO

/* ------------------------------------------------------------------ */
/* patients.portal_user_id                                            */
/* ------------------------------------------------------------------ */
IF COL_LENGTH(N'dbo.patients', N'portal_user_id') IS NULL
BEGIN
  ALTER TABLE dbo.patients
    ADD portal_user_id INT NULL;
END
GO

/* ------------------------------------------------------------------ */
/* FK_patients_portal_user                                            */
/* ------------------------------------------------------------------ */
IF COL_LENGTH(N'dbo.patients', N'portal_user_id') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = N'FK_patients_portal_user'
      AND parent_object_id = OBJECT_ID(N'dbo.patients')
  )
BEGIN
  ALTER TABLE dbo.patients WITH CHECK
    ADD CONSTRAINT FK_patients_portal_user
      FOREIGN KEY (portal_user_id)
      REFERENCES dbo.users (id)
      ON DELETE NO ACTION;
END
GO

/* ------------------------------------------------------------------ */
/* UX_patients_portal_user_id (filtered unique; NULLs allowed)        */
/* ------------------------------------------------------------------ */
IF COL_LENGTH(N'dbo.patients', N'portal_user_id') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_patients_portal_user_id'
      AND object_id = OBJECT_ID(N'dbo.patients')
  )
BEGIN
  CREATE UNIQUE INDEX UX_patients_portal_user_id
    ON dbo.patients (portal_user_id)
    WHERE portal_user_id IS NOT NULL;
END
GO

/*
  ---------------------------------------------------------------------------
  PRE-MIGRATION VERIFICATION (SELECT-only; run before ALTER if desired)
  ---------------------------------------------------------------------------

  SELECT DB_NAME() AS CurrentDatabase;

  SELECT id, patient_his_id, created_by_id
  FROM dbo.patients
  ORDER BY id;

  SELECT id, username, role, is_active
  FROM dbo.users
  ORDER BY id;

  SELECT COUNT(*) AS PatientUserCount
  FROM dbo.users
  WHERE role = N'patient';

  ---------------------------------------------------------------------------
  POST-MIGRATION VERIFICATION (SELECT-only)
  ---------------------------------------------------------------------------

  SELECT c.name
  FROM sys.columns c
  WHERE c.object_id = OBJECT_ID(N'dbo.patients')
    AND c.name = N'portal_user_id';

  SELECT fk.name
  FROM sys.foreign_keys fk
  WHERE fk.name = N'FK_patients_portal_user';

  SELECT i.name
  FROM sys.indexes i
  WHERE i.object_id = OBJECT_ID(N'dbo.patients')
    AND i.name = N'UX_patients_portal_user_id';

  SELECT
      p.id AS patient_id,
      p.patient_his_id,
      p.created_by_id,
      p.portal_user_id,
      u.id AS user_id,
      u.role AS user_role
  FROM dbo.patients p
  LEFT JOIN dbo.users u ON u.id = p.portal_user_id
  ORDER BY p.id;

  -- Expected after this migration alone (no automatic backfill):
  --   portal_user_id IS NULL for all existing patients
  --   created_by_id unchanged

  SELECT COUNT(*) AS PatientsWithoutPortalUser
  FROM dbo.patients
  WHERE portal_user_id IS NULL;

  ---------------------------------------------------------------------------
  ROLLBACK CONSIDERATIONS (MANUAL ONLY — do not run unless intentionally
  reverting Phase 6D-1 after verifying no portal_user_id links are required)
  ---------------------------------------------------------------------------

  1. Confirm no dependent application traffic expects portal_user_id.
  2. Confirm no notifications/messaging use linked portal users yet.
  3. If any patients.portal_user_id values are set, decide whether to
     deactivate/delete the corresponding users.role='patient' rows first.
  4. Then, only if safe:

     DROP INDEX UX_patients_portal_user_id ON dbo.patients;
     ALTER TABLE dbo.patients DROP CONSTRAINT FK_patients_portal_user;
     ALTER TABLE dbo.patients DROP COLUMN portal_user_id;

  Do NOT drop users.role='patient' rows without an explicit data review.
*/
