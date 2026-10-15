/*
  ACE Results Portal — Phase 7D
  Physician prescriptions → patient medications

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.
  DO NOT execute against ShanScheduler.
  DO NOT execute against CodeGeneratorDB.
  DO NOT execute against ACE_PatientPortal.

  This migration:
    - Creates dbo.prescriptions
    - Creates dbo.prescription_items
    - FKs to patients / users / prescriptions
    - Indexes for patient/physician/item lookups

  It does NOT:
    - Modify existing clinical result tables
    - Drop / truncate data
    - Touch LiveDB_ACE or ShanScheduler
    - Create users or portal accounts

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
  THROW 50002, 'dbo.patients is required before prescriptions.', 1;
END
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  THROW 50003, 'dbo.users is required before prescriptions.', 1;
END
GO

IF OBJECT_ID(N'dbo.prescriptions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.prescriptions (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_prescriptions PRIMARY KEY,
    patient_id INT NOT NULL,
    physician_id INT NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT DF_prescriptions_status DEFAULT (N'active'),
    diagnosis_or_indication NVARCHAR(500) NULL,
    general_instructions NVARCHAR(MAX) NULL,
    notes NVARCHAR(MAX) NULL,
    created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_prescriptions_created_at DEFAULT (SYSDATETIMEOFFSET()),
    updated_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_prescriptions_updated_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT CK_prescriptions_status CHECK (status IN (N'active', N'completed', N'cancelled')),
    CONSTRAINT FK_prescriptions_patient FOREIGN KEY (patient_id)
      REFERENCES dbo.patients (id) ON DELETE NO ACTION,
    CONSTRAINT FK_prescriptions_physician FOREIGN KEY (physician_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION
  );
END
GO

IF OBJECT_ID(N'dbo.prescription_items', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.prescription_items (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_prescription_items PRIMARY KEY,
    prescription_id INT NOT NULL,
    medicine_name NVARCHAR(255) NOT NULL,
    generic_name NVARCHAR(255) NULL,
    dosage NVARCHAR(100) NULL,
    dosage_unit NVARCHAR(50) NULL,
    route NVARCHAR(50) NULL,
    frequency NVARCHAR(100) NULL,
    duration NVARCHAR(100) NULL,
    quantity NVARCHAR(100) NULL,
    instructions NVARCHAR(500) NULL,
    created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_prescription_items_created_at DEFAULT (SYSDATETIMEOFFSET()),
    updated_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_prescription_items_updated_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT FK_prescription_items_prescription FOREIGN KEY (prescription_id)
      REFERENCES dbo.prescriptions (id) ON DELETE CASCADE
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_prescriptions_patient_status_created'
    AND object_id = OBJECT_ID(N'dbo.prescriptions')
)
BEGIN
  CREATE INDEX IX_prescriptions_patient_status_created
    ON dbo.prescriptions (patient_id, status, created_at DESC);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_prescriptions_physician_created'
    AND object_id = OBJECT_ID(N'dbo.prescriptions')
)
BEGIN
  CREATE INDEX IX_prescriptions_physician_created
    ON dbo.prescriptions (physician_id, created_at DESC);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_prescription_items_prescription_id'
    AND object_id = OBJECT_ID(N'dbo.prescription_items')
)
BEGIN
  CREATE INDEX IX_prescription_items_prescription_id
    ON dbo.prescription_items (prescription_id);
END
GO
