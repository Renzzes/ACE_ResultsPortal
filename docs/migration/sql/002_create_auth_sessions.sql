/*
  ACE Results Portal — SQL Server 2019
  Target database: ACE_ResultsPortal (already created)

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script.

  Review in SQL Server Management Studio (or sqlcmd) as a privileged DBA,
  then execute against ACE_ResultsPortal only.

  This script:
  - does NOT create or drop a database
  - does NOT drop or truncate tables
  - does NOT modify users, patients, results, or audit_logs
  - does NOT touch LiveDB_ACE, CodeGeneratorDB, ACE_PatientPortal,
    or any other hospital database

  Purpose: server-side refresh-session revocation.
  Refresh tokens are stored as SHA-256 hashes only (never plaintext).
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

IF OBJECT_ID(N'dbo.auth_sessions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.auth_sessions (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_auth_sessions PRIMARY KEY,
    user_id INT NOT NULL,
    refresh_token_hash CHAR(64) NOT NULL,
    expires_at DATETIMEOFFSET(7) NOT NULL,
    revoked_at DATETIMEOFFSET(7) NULL,
    created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_auth_sessions_created_at DEFAULT (SYSDATETIMEOFFSET()),
    last_used_at DATETIMEOFFSET(7) NULL,
    CONSTRAINT UQ_auth_sessions_refresh_token_hash UNIQUE (refresh_token_hash),
    CONSTRAINT FK_auth_sessions_user FOREIGN KEY (user_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_auth_sessions_user_id' AND object_id = OBJECT_ID(N'dbo.auth_sessions')
)
  CREATE INDEX IX_auth_sessions_user_id ON dbo.auth_sessions (user_id)
    INCLUDE (revoked_at, expires_at);
GO
