import type { Request } from "express";
import type { ResultRow } from "@workspace/db";
import { verifyResultAccessCode } from "./result-access-code";

export const PORTAL_ACCESS_CODE_HEADER = "x-portal-access-code";

export const RESULTS_ACCESS_REQUIRED_ERROR = "Access code required to view this document.";
export const RESULTS_ACCESS_INVALID_ERROR = "Invalid access code for this document.";

export async function verifyPortalResultAccessCode(
  req: Request,
  result: Pick<ResultRow, "accessCodeHash">,
): Promise<boolean> {
  const header = req.headers[PORTAL_ACCESS_CODE_HEADER];
  const accessCode = typeof header === "string" ? header.trim() : "";
  if (!accessCode) return false;
  return verifyResultAccessCode(result, accessCode);
}

/** @deprecated Patient-level unlock is retired; use verifyPortalResultAccessCode. */
export async function verifyPortalResultsAccessCode(
  req: Request,
  _patient: { accessCodeHash?: string | null },
): Promise<boolean> {
  void req;
  void _patient;
  return false;
}
