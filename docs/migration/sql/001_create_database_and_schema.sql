/*
  ACE Results Portal — SQL Server 2019
  Target instance: 198.15.0.201,1433 (default instance)
  Target database: ACE_ResultsPortal

  MANUAL EXECUTION ONLY.
  Cursor / the application MUST NOT run this script.

  Review in SQL Server Management Studio (or sqlcmd) as a privileged DBA,
  then execute against the hospital SQL Server.

  This script does not modify existing hospital databases
  (LiveDB_ACE, CodeGeneratorDB, ACE_PatientPortal, etc.).

  Production should use a dedicated application login with rights limited
  to ACE_ResultsPortal — do not permanently run the app as sa.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_ID(N'ACE_ResultsPortal') IS NULL
BEGIN
  CREATE DATABASE [ACE_ResultsPortal];
END
GO

USE [ACE_ResultsPortal];
GO

/* -------------------------------------------------------------------------- */
/* users                                                                      */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_users PRIMARY KEY,
    username NVARCHAR(64) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    first_name NVARCHAR(100) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,
    email NVARCHAR(255) NULL,
    role NVARCHAR(32) NOT NULL,
    is_active BIT NOT NULL CONSTRAINT DF_users_is_active DEFAULT (1),
    failed_login_attempts INT NOT NULL CONSTRAINT DF_users_failed_login_attempts DEFAULT (0),
    locked_until DATETIMEOFFSET(7) NULL,
    last_login_at DATETIMEOFFSET(7) NULL,
    created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_users_created_at DEFAULT (SYSDATETIMEOFFSET()),
    updated_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_users_updated_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT UQ_users_username UNIQUE (username),
    CONSTRAINT CK_users_role CHECK (role IN (
      N'super_admin', N'medical_records', N'laboratory', N'radiology', N'endoscopy', N'physician', N'patient'
    )),
    CONSTRAINT CK_users_failed_login_attempts CHECK (failed_login_attempts >= 0)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_users_role' AND object_id = OBJECT_ID(N'dbo.users'))
  CREATE INDEX IX_users_role ON dbo.users (role) INCLUDE (is_active);
GO

/* -------------------------------------------------------------------------- */
/* patients                                                                   */
/* access_code_hash stores bcrypt; plaintext is never persisted.              */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.patients', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.patients (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_patients PRIMARY KEY,
    patient_his_id NVARCHAR(64) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,
    first_name NVARCHAR(100) NOT NULL,
    middle_name NVARCHAR(100) NULL,
    date_of_birth DATE NOT NULL,
    mobile_number NVARCHAR(32) NULL,
    email NVARCHAR(255) NULL,
    access_code_hash NVARCHAR(255) NOT NULL,
    created_by_id INT NULL,
    created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_patients_created_at DEFAULT (SYSDATETIMEOFFSET()),
    updated_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_patients_updated_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT UQ_patients_patient_his_id UNIQUE (patient_his_id),
    CONSTRAINT FK_patients_created_by FOREIGN KEY (created_by_id)
      REFERENCES dbo.users (id) ON DELETE SET NULL
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_patients_last_name' AND object_id = OBJECT_ID(N'dbo.patients'))
  CREATE INDEX IX_patients_last_name ON dbo.patients (last_name);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_patients_created_by_id' AND object_id = OBJECT_ID(N'dbo.patients'))
  CREATE INDEX IX_patients_created_by_id ON dbo.patients (created_by_id);
GO

/* -------------------------------------------------------------------------- */
/* patient_physicians                                                         */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.patient_physicians', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.patient_physicians (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_patient_physicians PRIMARY KEY,
    patient_id INT NOT NULL,
    physician_id INT NOT NULL,
    assigned_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_patient_physicians_assigned_at DEFAULT (SYSDATETIMEOFFSET()),
    assigned_by_id INT NULL,
    CONSTRAINT UQ_patient_physicians_pair UNIQUE (patient_id, physician_id),
    CONSTRAINT FK_patient_physicians_patient FOREIGN KEY (patient_id)
      REFERENCES dbo.patients (id) ON DELETE NO ACTION,
    CONSTRAINT FK_patient_physicians_physician FOREIGN KEY (physician_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION,
    CONSTRAINT FK_patient_physicians_assigned_by FOREIGN KEY (assigned_by_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_patient_physicians_physician_id' AND object_id = OBJECT_ID(N'dbo.patient_physicians'))
  CREATE INDEX IX_patient_physicians_physician_id ON dbo.patient_physicians (physician_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_patient_physicians_assigned_by_id' AND object_id = OBJECT_ID(N'dbo.patient_physicians'))
  CREATE INDEX IX_patient_physicians_assigned_by_id ON dbo.patient_physicians (assigned_by_id);
GO

/* -------------------------------------------------------------------------- */
/* results                                                                    */
/* scheduled_release_date is DATE (was PostgreSQL text).                      */
/* ON DELETE NO ACTION on patient_id — results are not cascade-deleted.       */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.results', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.results (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_results PRIMARY KEY,
    patient_id INT NOT NULL,
    category NVARCHAR(32) NOT NULL,
    file_name NVARCHAR(255) NOT NULL,
    original_file_name NVARCHAR(255) NOT NULL,
    file_type NVARCHAR(8) NOT NULL,
    file_size_bytes BIGINT NULL,
    release_option NVARCHAR(32) NOT NULL,
    scheduled_release_date DATE NULL,
    date_released DATETIMEOFFSET(7) NULL,
    status NVARCHAR(16) NOT NULL CONSTRAINT DF_results_status DEFAULT (N'pending'),
    remarks NVARCHAR(MAX) NULL,
    uploaded_by_id INT NOT NULL,
    uploaded_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_results_uploaded_at DEFAULT (SYSDATETIMEOFFSET()),
    created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_results_created_at DEFAULT (SYSDATETIMEOFFSET()),
    updated_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_results_updated_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT CK_results_category CHECK (category IN (
      N'laboratory', N'radiology', N'ultrasound', N'ct_scan', N'mri',
      N'ecg', N'echo_2d', N'rehabilitation', N'other'
    )),
    CONSTRAINT CK_results_file_type CHECK (file_type IN (N'pdf', N'jpeg', N'png')),
    CONSTRAINT CK_results_release_option CHECK (release_option IN (
      N'immediate', N'after_physician_review', N'scheduled'
    )),
    CONSTRAINT CK_results_status CHECK (status IN (N'pending', N'released', N'archived')),
    CONSTRAINT FK_results_patient FOREIGN KEY (patient_id)
      REFERENCES dbo.patients (id) ON DELETE NO ACTION,
    CONSTRAINT FK_results_uploaded_by FOREIGN KEY (uploaded_by_id)
      REFERENCES dbo.users (id) ON DELETE NO ACTION
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_results_patient_id' AND object_id = OBJECT_ID(N'dbo.results'))
  CREATE INDEX IX_results_patient_id ON dbo.results (patient_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_results_status' AND object_id = OBJECT_ID(N'dbo.results'))
  CREATE INDEX IX_results_status ON dbo.results (status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_results_category' AND object_id = OBJECT_ID(N'dbo.results'))
  CREATE INDEX IX_results_category ON dbo.results (category);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_results_uploaded_at' AND object_id = OBJECT_ID(N'dbo.results'))
  CREATE INDEX IX_results_uploaded_at ON dbo.results (uploaded_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_results_uploaded_by_id' AND object_id = OBJECT_ID(N'dbo.results'))
  CREATE INDEX IX_results_uploaded_by_id ON dbo.results (uploaded_by_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_results_scheduled_release' AND object_id = OBJECT_ID(N'dbo.results'))
  CREATE INDEX IX_results_scheduled_release ON dbo.results (status, release_option, scheduled_release_date);
GO

/* -------------------------------------------------------------------------- */
/* audit_logs                                                                 */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.audit_logs (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_audit_logs PRIMARY KEY,
    action NVARCHAR(32) NOT NULL,
    user_id INT NULL,
    user_name NVARCHAR(200) NULL,
    patient_his_id NVARCHAR(64) NULL,
    result_id INT NULL,
    ip_address NVARCHAR(64) NOT NULL,
    details NVARCHAR(MAX) NULL,
    created_at DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_audit_logs_created_at DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT CK_audit_logs_action CHECK (action IN (
      N'login', N'logout', N'upload', N'edit', N'delete', N'view',
      N'download', N'access_denied', N'access_code_regen'
    )),
    CONSTRAINT FK_audit_logs_user FOREIGN KEY (user_id)
      REFERENCES dbo.users (id) ON DELETE SET NULL,
    CONSTRAINT FK_audit_logs_result FOREIGN KEY (result_id)
      REFERENCES dbo.results (id) ON DELETE SET NULL
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_audit_logs_created_at' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
  CREATE INDEX IX_audit_logs_created_at ON dbo.audit_logs (created_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_audit_logs_user_id' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
  CREATE INDEX IX_audit_logs_user_id ON dbo.audit_logs (user_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_audit_logs_action' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
  CREATE INDEX IX_audit_logs_action ON dbo.audit_logs (action);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_audit_logs_patient_his_id' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
  CREATE INDEX IX_audit_logs_patient_his_id ON dbo.audit_logs (patient_his_id);
GO
