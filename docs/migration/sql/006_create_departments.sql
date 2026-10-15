/*
  006_create_departments.sql

  Departments become data-driven (Admin can add/edit).
  Staff account role values continue to use department.code for RBAC.

  - Creates dbo.departments
  - Seeds current departments
  - Drops rigid CK_users_role / CK_role_permissions_role so new
    department codes can be stored as users.role

  MANUAL EXECUTION OK. Safe to re-run.
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

IF OBJECT_ID(N'dbo.departments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.departments (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_departments PRIMARY KEY,
    code NVARCHAR(32) NOT NULL,
    name NVARCHAR(100) NOT NULL,
    is_active BIT NOT NULL CONSTRAINT DF_departments_is_active DEFAULT (1),
    sort_order INT NOT NULL CONSTRAINT DF_departments_sort_order DEFAULT (0),
    result_scope NVARCHAR(32) NOT NULL CONSTRAINT DF_departments_result_scope DEFAULT (N'other'),
    created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_departments_created_at DEFAULT (SYSDATETIMEOFFSET()),
    updated_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_departments_updated_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT UQ_departments_code UNIQUE (code),
    CONSTRAINT CK_departments_code CHECK (
      code NOT LIKE N'%[^a-z0-9_]%' AND LEN(code) >= 2 AND LEN(code) <= 32
    ),
    CONSTRAINT CK_departments_result_scope CHECK (
      result_scope IN (N'all', N'laboratory', N'radiology', N'other')
    )
  );
END
GO

MERGE dbo.departments AS target
USING (VALUES
  (N'medical_records', N'Medical Records', 1, 10, N'all'),
  (N'laboratory', N'Laboratory', 1, 20, N'laboratory'),
  (N'radiology', N'Radiology', 1, 30, N'radiology'),
  (N'endoscopy', N'Endoscopy', 1, 40, N'other')
) AS source (code, name, is_active, sort_order, result_scope)
ON target.code = source.code
WHEN NOT MATCHED THEN
  INSERT (code, name, is_active, sort_order, result_scope)
  VALUES (source.code, source.name, source.is_active, source.sort_order, source.result_scope)
WHEN MATCHED THEN
  UPDATE SET
    name = source.name,
    is_active = source.is_active,
    sort_order = source.sort_order,
    result_scope = source.result_scope,
    updated_at = SYSDATETIMEOFFSET();
GO

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_users_role' AND parent_object_id = OBJECT_ID(N'dbo.users')
)
BEGIN
  ALTER TABLE dbo.users DROP CONSTRAINT CK_users_role;
END
GO

IF OBJECT_ID(N'dbo.role_permissions', N'U') IS NOT NULL
AND EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_role_permissions_role'
    AND parent_object_id = OBJECT_ID(N'dbo.role_permissions')
)
BEGIN
  ALTER TABLE dbo.role_permissions DROP CONSTRAINT CK_role_permissions_role;
END
GO

/* Seed default permissions for each department code (idempotent). */
IF OBJECT_ID(N'dbo.role_permissions', N'U') IS NOT NULL
BEGIN
  MERGE dbo.role_permissions AS target
  USING (
    SELECT d.code AS role, p.permission, p.allowed
    FROM dbo.departments AS d
    CROSS APPLY (VALUES
      (N'users', CAST(0 AS BIT)),
      (N'patients', CAST(1 AS BIT)),
      (N'results', CAST(1 AS BIT)),
      (N'audit', CASE WHEN d.code = N'medical_records' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END),
      (N'archive', CASE WHEN d.code = N'medical_records' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END),
      (N'settings', CAST(0 AS BIT))
    ) AS p (permission, allowed)
  ) AS source (role, permission, allowed)
  ON target.role = source.role AND target.permission = source.permission
  WHEN NOT MATCHED THEN
    INSERT (role, permission, allowed) VALUES (source.role, source.permission, source.allowed);
END
GO
