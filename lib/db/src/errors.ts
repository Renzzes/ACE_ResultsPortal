export class HospitalQueryError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("HOSPITAL_DB_UNAVAILABLE");
    this.name = "HospitalQueryError";
    this.cause = cause;
  }
}

export class PatientDepartmentSchemaError extends Error {
  constructor() {
    super("dbo.patient_departments is not installed");
    this.name = "PatientDepartmentSchemaError";
  }
}
