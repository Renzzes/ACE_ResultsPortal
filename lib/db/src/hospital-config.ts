const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  return value.trim();
}

/**
 * Qualifier for three-part hospital SELECTs. Never used as the mssql pool database.
 * The application pool always connects to DB_DATABASE (ACE_ResultsPortal).
 */
export function loadHospitalDatabaseName(): string {
  const name = optional("HIS_DB_DATABASE") ?? optional("HOSPITAL_DB_DATABASE");
  if (!name) {
    throw new Error("HOSPITAL_DB_UNAVAILABLE");
  }
  if (!IDENTIFIER.test(name)) {
    throw new Error("HOSPITAL_DB_UNAVAILABLE");
  }
  const portal = optional("DB_DATABASE");
  if (portal && name.toLowerCase() === portal.toLowerCase()) {
    throw new Error("HOSPITAL_DB_UNAVAILABLE");
  }
  return name;
}

export function isHospitalUnavailableError(err: unknown): boolean {
  return err instanceof Error && err.message === "HOSPITAL_DB_UNAVAILABLE";
}
