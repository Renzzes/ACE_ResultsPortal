/*
  ACE Results Portal — SQL Server 2019
  Target database: ACE_ResultsPortal (already created)

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script.
  Do NOT run against LiveDB_ACE.

  Purpose: add Admin Roles & Permissions column "upload_results"
  so Medical Records (and other roles) can be granted file-upload access
  independently from the coarse "results" permission.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

USE [ACE_ResultsPortal];
GO

IF DB_NAME() <> N'ACE_ResultsPortal'
BEGIN
  THROW 50001, 'This script must run in ACE_ResultsPortal only.', 1;
END
GO

IF OBJECT_ID(N'dbo.role_permissions', N'U') IS NULL
BEGIN
  THROW 50002, 'dbo.role_permissions is required. Run 003_create_role_permissions.sql first.', 1;
END
GO

/* Widen permission CHECK to include upload_results. */
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_role_permissions_permission'
    AND parent_object_id = OBJECT_ID(N'dbo.role_permissions')
)
BEGIN
  ALTER TABLE dbo.role_permissions DROP CONSTRAINT CK_role_permissions_permission;
END
GO

ALTER TABLE dbo.role_permissions WITH CHECK ADD CONSTRAINT CK_role_permissions_permission CHECK (permission IN (
  N'users', N'patients', N'results', N'upload_results', N'audit', N'archive', N'settings'
));
GO

/* Seed defaults: department clinical roles + Medical Records may upload; physician may not. */
MERGE dbo.role_permissions AS target
USING (VALUES
  (N'super_admin', N'upload_results', 1),
  (N'medical_records', N'upload_results', 1),
  (N'laboratory', N'upload_results', 1),
  (N'radiology', N'upload_results', 1),
  (N'endoscopy', N'upload_results', 1),
  (N'physician', N'upload_results', 0)
) AS source (role, permission, allowed)
ON target.role = source.role AND target.permission = source.permission
WHEN MATCHED THEN
  UPDATE SET allowed = source.allowed, updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (role, permission, allowed) VALUES (source.role, source.permission, source.allowed);
GO
