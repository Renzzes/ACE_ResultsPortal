/*
  ACE Results Portal — Patient Contact Support + forced password change

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script against production automatically.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  This migration:
    - Adds dbo.users.must_change_password (BIT NOT NULL DEFAULT 0)
    - Adds dbo.users.password_expires_at (DATETIMEOFFSET NULL)
    - Creates dbo.patient_support_requests for unauthenticated Contact Support

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
  THROW 50002, 'dbo.users is required.', 1;
END
GO

IF COL_LENGTH(N'dbo.users', N'must_change_password') IS NULL
BEGIN
  ALTER TABLE dbo.users
    ADD must_change_password BIT NOT NULL
      CONSTRAINT DF_users_must_change_password DEFAULT (0);
END
GO

IF COL_LENGTH(N'dbo.users', N'password_expires_at') IS NULL
BEGIN
  ALTER TABLE dbo.users
    ADD password_expires_at DATETIMEOFFSET NULL;
END
GO

IF OBJECT_ID(N'dbo.patient_support_requests', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.patient_support_requests (
    id                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_patient_support_requests PRIMARY KEY,
    category          NVARCHAR(64) NOT NULL,
    patient_his_id    NVARCHAR(64) NOT NULL,
    last_name         NVARCHAR(100) NOT NULL,
    contact_email     NVARCHAR(255) NULL,
    details           NVARCHAR(1000) NULL,
    status            NVARCHAR(32) NOT NULL
      CONSTRAINT DF_psr_status DEFAULT (N'pending'),
    matched_patient_id INT NULL,
    processed_by_id   INT NULL,
    processed_at      DATETIMEOFFSET NULL,
    admin_notes       NVARCHAR(500) NULL,
    requester_ip_hash NVARCHAR(64) NULL,
    created_at        DATETIMEOFFSET NOT NULL
      CONSTRAINT DF_psr_created_at DEFAULT (SYSDATETIMEOFFSET()),
    updated_at        DATETIMEOFFSET NOT NULL
      CONSTRAINT DF_psr_updated_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT CK_psr_category CHECK (
      category IN (N'temporary_password', N'diagnostic_access_code')
    ),
    CONSTRAINT CK_psr_status CHECK (
      status IN (N'pending', N'processing', N'completed', N'rejected')
    ),
    CONSTRAINT FK_psr_matched_patient
      FOREIGN KEY (matched_patient_id) REFERENCES dbo.patients (id),
    CONSTRAINT FK_psr_processed_by
      FOREIGN KEY (processed_by_id) REFERENCES dbo.users (id)
  );

  CREATE INDEX IX_psr_status_created
    ON dbo.patient_support_requests (status, created_at DESC);

  CREATE INDEX IX_psr_his_created
    ON dbo.patient_support_requests (patient_his_id, created_at DESC);
END
GO

/*
  ROLLBACK (manual, after confirming no production dependency):

  DROP TABLE IF EXISTS dbo.patient_support_requests;

  IF COL_LENGTH(N'dbo.users', N'password_expires_at') IS NOT NULL
    ALTER TABLE dbo.users DROP COLUMN password_expires_at;

  IF COL_LENGTH(N'dbo.users', N'must_change_password') IS NOT NULL
  BEGIN
    DECLARE @df sysname;
    SELECT @df = dc.name
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c ON c.default_object_id = dc.object_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.users')
      AND c.name = N'must_change_password';
    IF @df IS NOT NULL EXEC(N'ALTER TABLE dbo.users DROP CONSTRAINT [' + @df + N']');
    ALTER TABLE dbo.users DROP COLUMN must_change_password;
  END
*/
