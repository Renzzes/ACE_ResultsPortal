/*
  005_add_endoscopy_department.sql

  Adds Endoscopy as a staff department role (users.role = N'endoscopy').
  Safe to re-run.
*/
USE [ACE_ResultsPortal];
GO

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = N'CK_users_role'
    AND parent_object_id = OBJECT_ID(N'dbo.users')
)
BEGIN
  ALTER TABLE dbo.users DROP CONSTRAINT CK_users_role;
END
GO

ALTER TABLE dbo.users WITH CHECK ADD CONSTRAINT CK_users_role CHECK (
  role IN (
    N'super_admin',
    N'medical_records',
    N'laboratory',
    N'radiology',
    N'endoscopy',
    N'physician',
    N'patient'
  )
);
GO

IF OBJECT_ID(N'dbo.role_permissions', N'U') IS NOT NULL
BEGIN
  IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_role_permissions_role'
      AND parent_object_id = OBJECT_ID(N'dbo.role_permissions')
  )
  BEGIN
    ALTER TABLE dbo.role_permissions DROP CONSTRAINT CK_role_permissions_role;
  END

  ALTER TABLE dbo.role_permissions WITH CHECK ADD CONSTRAINT CK_role_permissions_role CHECK (
    role IN (
      N'super_admin', N'medical_records', N'laboratory', N'radiology', N'endoscopy', N'physician'
    )
  );

  MERGE dbo.role_permissions AS target
  USING (VALUES
    (N'endoscopy', N'users', 0),
    (N'endoscopy', N'patients', 1),
    (N'endoscopy', N'results', 1),
    (N'endoscopy', N'audit', 0),
    (N'endoscopy', N'archive', 0),
    (N'endoscopy', N'settings', 0)
  ) AS source (role, permission, allowed)
  ON target.role = source.role AND target.permission = source.permission
  WHEN NOT MATCHED THEN
    INSERT (role, permission, allowed) VALUES (source.role, source.permission, source.allowed);
END
GO
