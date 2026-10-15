/*
  ACE Results Portal — Phase C
  Patient ↔ department membership

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script on startup.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against ShanScheduler.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  This migration:
    - Creates dbo.patient_departments
    - FKs to patients / departments / users
    - Unique (patient_id, department_id)
    - Index for department lookups

  It does NOT:
    - Insert membership rows
    - Infer membership from created_by, result category, uploader, or physician assignment
    - Modify existing patient rows
    - Add patients.department_id
    - Add results.department_id
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

IF OBJECT_ID(N'dbo.patients', N'U') IS NULL
BEGIN
  THROW 50002, 'dbo.patients is required before patient department membership.', 1;
END
GO

IF OBJECT_ID(N'dbo.departments', N'U') IS NULL
BEGIN
  THROW 50003, 'dbo.departments is required before patient department membership.', 1;
END
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  THROW 50004, 'dbo.users is required before patient department membership.', 1;
END
GO

IF OBJECT_ID(N'dbo.patient_departments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.patient_departments (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_patient_departments PRIMARY KEY,
    patient_id INT NOT NULL,
    department_id INT NOT NULL,
    registered_by_id INT NULL,
    registered_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_patient_departments_registered_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT UQ_patient_departments_patient_department UNIQUE (patient_id, department_id),
    CONSTRAINT FK_patient_departments_patient FOREIGN KEY (patient_id)
      REFERENCES dbo.patients (id) ON DELETE CASCADE,
    CONSTRAINT FK_patient_departments_department FOREIGN KEY (department_id)
      REFERENCES dbo.departments (id) ON DELETE NO ACTION,
    CONSTRAINT FK_patient_departments_registered_by FOREIGN KEY (registered_by_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_patient_departments_department_id'
    AND object_id = OBJECT_ID(N'dbo.patient_departments')
)
BEGIN
  CREATE INDEX IX_patient_departments_department_id
    ON dbo.patient_departments (department_id, patient_id);
END
GO
