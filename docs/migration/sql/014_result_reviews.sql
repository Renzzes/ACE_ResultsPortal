/*
  ACE Results Portal — Phase G
  Physician result review persistence

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script on startup.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against ShanScheduler.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  This migration:
    - Creates dbo.result_reviews
    - FKs to results / users
    - Unique (result_id, physician_id)
    - Indexes for result and physician lookups

  It does NOT:
    - Modify the results table
    - Insert review rows
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
  THROW 50002, 'dbo.results is required before physician result reviews.', 1;
END
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  THROW 50003, 'dbo.users is required before physician result reviews.', 1;
END
GO

IF OBJECT_ID(N'dbo.result_reviews', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.result_reviews (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_result_reviews PRIMARY KEY,
    result_id INT NOT NULL,
    physician_id INT NOT NULL,
    comment NVARCHAR(MAX) NULL,
    reviewed_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_result_reviews_reviewed_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT UQ_result_reviews_result_physician UNIQUE (result_id, physician_id),
    CONSTRAINT FK_result_reviews_result FOREIGN KEY (result_id)
      REFERENCES dbo.results (id) ON DELETE CASCADE,
    CONSTRAINT FK_result_reviews_physician FOREIGN KEY (physician_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_result_reviews_result_id'
    AND object_id = OBJECT_ID(N'dbo.result_reviews')
)
BEGIN
  CREATE INDEX IX_result_reviews_result_id
    ON dbo.result_reviews (result_id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_result_reviews_physician_id'
    AND object_id = OBJECT_ID(N'dbo.result_reviews')
)
BEGIN
  CREATE INDEX IX_result_reviews_physician_id
    ON dbo.result_reviews (physician_id);
END
GO
