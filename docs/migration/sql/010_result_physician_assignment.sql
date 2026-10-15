/*
  ACE Results Portal — Phase 7B
  Result → Physician assignment (private review access)

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against ShanScheduler.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  This migration:
    - Creates dbo.result_physicians
    - FKs to results / users
    - Unique (result_id, physician_id)
    - Indexes for result_id and physician_id lookups

  It does NOT:
    - Modify existing results rows
    - Drop / truncate data
    - Touch LiveDB_ACE or ShanScheduler

  Safe to re-run (IF OBJECT_ID / IF NOT EXISTS guards).
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
  THROW 50002, 'dbo.results is required before result physician assignment.', 1;
END
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  THROW 50003, 'dbo.users is required before result physician assignment.', 1;
END
GO

IF OBJECT_ID(N'dbo.result_physicians', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.result_physicians (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_result_physicians PRIMARY KEY,
    result_id INT NOT NULL,
    physician_id INT NOT NULL,
    assigned_by_id INT NULL,
    assigned_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_result_physicians_assigned_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT UQ_result_physicians_result_physician UNIQUE (result_id, physician_id),
    CONSTRAINT FK_result_physicians_result FOREIGN KEY (result_id)
      REFERENCES dbo.results (id) ON DELETE CASCADE,
    CONSTRAINT FK_result_physicians_physician FOREIGN KEY (physician_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION,
    CONSTRAINT FK_result_physicians_assigned_by FOREIGN KEY (assigned_by_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_result_physicians_result_id'
    AND object_id = OBJECT_ID(N'dbo.result_physicians')
)
BEGIN
  CREATE INDEX IX_result_physicians_result_id ON dbo.result_physicians (result_id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_result_physicians_physician_id'
    AND object_id = OBJECT_ID(N'dbo.result_physicians')
)
BEGIN
  CREATE INDEX IX_result_physicians_physician_id ON dbo.result_physicians (physician_id);
END
GO
