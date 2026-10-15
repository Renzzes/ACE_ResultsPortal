-- Access code request tracking for Patient Portal results unlock.
-- Patients can request a new access code; admins see the request and email a regenerated code.

USE ACE_ResultsPortal;
GO

IF COL_LENGTH('dbo.patients', 'access_code_requested_at') IS NULL
BEGIN
  ALTER TABLE dbo.patients
    ADD access_code_requested_at DATETIMEOFFSET NULL;
END
GO
