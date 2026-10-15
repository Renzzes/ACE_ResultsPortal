const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  return value.trim();
}

/**
 * Qualifier for three-part ShanScheduler SELECTs. Never used as the mssql pool database.
 * The application pool always connects to DB_DATABASE (ACE_ResultsPortal).
 */
export function loadSchedulerDatabaseName(): string {
  const name =
    optional("SCHEDULER_DB_DATABASE") ??
    optional("SHANSCHEDULER_DB_DATABASE") ??
    optional("SHAN_SCHEDULER_DB_DATABASE");
  if (!name) {
    throw new Error("SCHEDULER_DB_UNAVAILABLE");
  }
  if (!IDENTIFIER.test(name)) {
    throw new Error("SCHEDULER_DB_UNAVAILABLE");
  }
  const portal = optional("DB_DATABASE");
  if (portal && name.toLowerCase() === portal.toLowerCase()) {
    throw new Error("SCHEDULER_DB_UNAVAILABLE");
  }
  return name;
}

export function isSchedulerUnavailableError(err: unknown): boolean {
  return err instanceof Error && err.message === "SCHEDULER_DB_UNAVAILABLE";
}
