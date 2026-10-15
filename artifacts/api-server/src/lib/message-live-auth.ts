/**
 * Realtime identity uses the same token and session checks as the REST middleware.
 * The bearer token is read from the first socket frame, never from the URL.
 */
import { authSessionsRepo, patientsRepo } from "@workspace/db";
import { isSessionPublicId, verifyToken } from "./auth";
import { resolvePortalMessagingIdentity } from "./portal-messaging";

export type LiveIdentity = {
  userId: number;
  audience: "staff" | "portal";
  sessionPublicId?: string;
};

export async function authenticateLiveSocket(token: string): Promise<LiveIdentity | null> {
  const payload = verifyToken(token);
  if (!payload) return null;

  if (payload["type"] === "access") {
    const userId = Number(payload["userId"]);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    if (payload["role"] === "patient") return null;
    const sid = payload["sid"];
    if (sid !== undefined) {
      if (typeof sid !== "string" || !isSessionPublicId(sid)) return null;
      const session = await authSessionsRepo.findUsableByPublicId(sid);
      if (!session || session.userId !== userId || session.portal == null) return null;
      return { userId, audience: "staff", sessionPublicId: sid };
    }
    return { userId, audience: "staff" };
  }

  if (payload["type"] === "portal") {
    const patientId = Number(payload["patientId"]);
    const patientHisId = typeof payload["patientHisId"] === "string" ? payload["patientHisId"] : "";
    if (!Number.isFinite(patientId) || patientId <= 0 || !patientHisId) return null;
    const sid = payload["sid"];
    let sessionPublicId: string | undefined;
    if (sid !== undefined) {
      if (typeof sid !== "string" || !isSessionPublicId(sid)) return null;
      const session = await authSessionsRepo.findUsableByPublicId(sid);
      if (!session || session.portal !== "patient") return null;
      const patient = await patientsRepo.findPatientByPortalUserId(session.userId);
      if (!patient || patient.id !== patientId || patient.patientHisId !== patientHisId) return null;
      sessionPublicId = sid;
    }
    const identity = await resolvePortalMessagingIdentity(patientId, patientHisId);
    if (!identity.ok) return null;
    return {
      userId: identity.portalUserId,
      audience: "portal",
      ...(sessionPublicId ? { sessionPublicId } : {}),
    };
  }

  return null;
}

export async function liveSessionStillValid(identity: LiveIdentity): Promise<boolean> {
  if (!identity.sessionPublicId) return true;
  const session = await authSessionsRepo.findUsableByPublicId(identity.sessionPublicId);
  if (!session || session.userId !== identity.userId) return false;
  if (identity.audience === "portal") return session.portal === "patient";
  return session.portal != null;
}
