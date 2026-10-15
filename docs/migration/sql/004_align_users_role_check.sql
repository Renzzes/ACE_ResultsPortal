/*
  004_align_users_role_check.sql

  Live databases created earlier used:
    patient | physician | staff | super_admin

  The application expects:
    super_admin | medical_records | laboratory | radiology | physician | patient

  Order matters:
  1) drop CK_users_role
  2) remap legacy N'staff' -> N'medical_records'
  3) add the application role check

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

UPDATE dbo.users
SET role = N'medical_records',
    updated_at = SYSDATETIMEOFFSET()
WHERE role = N'staff';
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = N'CK_users_role'
    AND parent_object_id = OBJECT_ID(N'dbo.users')
)
BEGIN
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
END
GO
