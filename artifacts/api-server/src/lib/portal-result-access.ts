import type { Request } from "express";
import type { Patient } from "@workspace/db";
import { compareAccessCode } from "./auth";

export const PORTAL_ACCESS_CODE_HEADER = "x-portal-access-code";

export const RESULTS_ACCESS_REQUIRED_ERROR = "Access code required to view results.";
export const RESULTS_ACCESS_INVALID_ERROR = "Invalid access code.";

export async function verifyPortalResultsAccessCode(
  req: Request,
  patient: Pick<Patient, "accessCodeHash">,
): Promise<boolean> {
  const header = req.headers[PORTAL_ACCESS_CODE_HEADER];
  const accessCode = typeof header === "string" ? header.trim() : "";
  if (!accessCode || !patient.accessCodeHash) return false;
  return compareAccessCode(accessCode, patient.accessCodeHash);
}
