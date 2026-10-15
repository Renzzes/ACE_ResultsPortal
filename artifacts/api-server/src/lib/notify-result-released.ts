import {
  notificationsRepo,
  patientsRepo,
  type ResultCategory,
} from "@workspace/db";
import { resolveActivePortalAccount } from "./portal-activation";
import { logger } from "./logger";

/** Notification type for patient result-release events (dbo.notifications.type). */
export const PATIENT_RESULT_RELEASED_TYPE = "result_released";

function patientResultBody(category: ResultCategory | string): string {
  if (category === "laboratory") {
    return "Your laboratory result has been released and is now available.";
  }
  if (
    category === "radiology" ||
    category === "ultrasound" ||
    category === "ct_scan" ||
    category === "mri"
  ) {
    return "Your radiology result has been released and is now available.";
  }
  return "Your diagnostic result has been released and is now available.";
}

/**
 * After a result has actually become status=released, notify the patient's
 * portal user (if activated). Deduped by (recipient, type, entity).
 *
 * Consistency: post-commit / fire-and-forget side effect (same model as
 * notifyResultUploaded). Release remains authoritative if notify fails.
 */
export async function notifyPatientResultReleased(input: {
  resultId: number;
  patientId: number;
  category: ResultCategory | string;
}): Promise<void> {
  if (!(await notificationsRepo.messagingSchemaReady())) return;

  const patient = await patientsRepo.findPatientById(input.patientId);
  if (!patient) return;

  const portalAccount = await resolveActivePortalAccount(patient);
  if (!portalAccount.ok) {
    // Hospital-only patient (no portal_user_id / inactive / wrong role) — skip.
    return;
  }

  const created = await notificationsRepo.insertNotificationsDeduped(
    [portalAccount.user.id],
    {
      type: PATIENT_RESULT_RELEASED_TYPE,
      title: "New Result Available",
      body: patientResultBody(input.category),
      entityType: "result",
      entityId: input.resultId,
      priority: "important",
    },
  );

  if (created > 0) {
    logger.info(
      { resultId: input.resultId, recipientUserId: portalAccount.user.id, created },
      "patient_result_released_notification",
    );
  }
}
