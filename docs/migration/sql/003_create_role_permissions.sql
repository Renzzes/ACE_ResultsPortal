/*
  ACE Results Portal — SQL Server 2019
  Target database: ACE_ResultsPortal (already created)

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script.

  Purpose: persist Admin Roles & Permissions matrix edits.
  Does NOT modify LiveDB_ACE or other hospital databases.
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
  CREATE TABLE dbo.role_permissions (
    role NVARCHAR(32) NOT NULL,
    permission NVARCHAR(32) NOT NULL,
    allowed BIT NOT NULL CONSTRAINT DF_role_permissions_allowed DEFAULT (0),
    updated_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_role_permissions_updated_at DEFAULT (SYSDATETIMEOFFSET()),
    updated_by_id INT NULL,
    CONSTRAINT PK_role_permissions PRIMARY KEY (role, permission),
    CONSTRAINT CK_role_permissions_role CHECK (role IN (
      N'super_admin', N'medical_records', N'laboratory', N'radiology', N'endoscopy', N'physician'
    )),
    CONSTRAINT CK_role_permissions_permission CHECK (permission IN (
      N'users', N'patients', N'results', N'upload_results', N'audit', N'archive', N'settings'
    )),
    CONSTRAINT FK_role_permissions_updated_by FOREIGN KEY (updated_by_id)
      REFERENCES dbo.users (id) ON DELETE SET NULL
  );
END
GO

/* Seed defaults matching current API RBAC (idempotent). */
MERGE dbo.role_permissions AS target
USING (VALUES
  (N'super_admin', N'users', 1),
  (N'super_admin', N'patients', 1),
  (N'super_admin', N'results', 1),
  (N'super_admin', N'upload_results', 1),
  (N'super_admin', N'audit', 1),
  (N'super_admin', N'archive', 1),
  (N'super_admin', N'settings', 1),
  (N'medical_records', N'users', 0),
  (N'medical_records', N'patients', 1),
  (N'medical_records', N'results', 1),
  (N'medical_records', N'upload_results', 1),
  (N'medical_records', N'audit', 1),
  (N'medical_records', N'archive', 1),
  (N'medical_records', N'settings', 0),
  (N'laboratory', N'users', 0),
  (N'laboratory', N'patients', 1),
  (N'laboratory', N'results', 1),
  (N'laboratory', N'upload_results', 1),
  (N'laboratory', N'audit', 0),
  (N'laboratory', N'archive', 0),
  (N'laboratory', N'settings', 0),
  (N'radiology', N'users', 0),
  (N'radiology', N'patients', 1),
  (N'radiology', N'results', 1),
  (N'radiology', N'upload_results', 1),
  (N'radiology', N'audit', 0),
  (N'radiology', N'archive', 0),
  (N'radiology', N'settings', 0),
  (N'endoscopy', N'users', 0),
  (N'endoscopy', N'patients', 1),
  (N'endoscopy', N'results', 1),
  (N'endoscopy', N'upload_results', 1),
  (N'endoscopy', N'audit', 0),
  (N'endoscopy', N'archive', 0),
  (N'endoscopy', N'settings', 0),
  (N'physician', N'users', 0),
  (N'physician', N'patients', 1),
  (N'physician', N'results', 1),
  (N'physician', N'upload_results', 0),
  (N'physician', N'audit', 0),
  (N'physician', N'archive', 0),
  (N'physician', N'settings', 0)
) AS source (role, permission, allowed)
ON target.role = source.role AND target.permission = source.permission
WHEN NOT MATCHED THEN
  INSERT (role, permission, allowed) VALUES (source.role, source.permission, source.allowed);
GO
