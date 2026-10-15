import {
  notificationsRepo,
  patientsRepo,
} from "@workspace/db";
import { resolveActivePortalAccount } from "./portal-activation";
import { logger } from "./logger";

export const PATIENT_PRESCRIPTION_CREATED_TYPE = "prescription_created";
export const PATIENT_PRESCRIPTION_CREATED_BODY = "You have received a new prescription.";
export const PATIENT_PRESCRIPTION_CREATED_TITLE = "New prescription available";

/**
 * Notify the patient's linked portal user after a prescription is committed.
 * Best-effort / post-commit. Does not grant authorization.
 */
export async function notifyPatientPrescriptionCreated(input: {
  prescriptionId: number;
  patientId: number;
}): Promise<void> {
  if (!(await notificationsRepo.messagingSchemaReady())) return;

  const patient = await patientsRepo.findPatientById(input.patientId);
  if (!patient) return;

  const portalAccount = await resolveActivePortalAccount(patient);
  if (!portalAccount.ok) {
    // Hospital-only / inactive / missing portal link — skip safely.
    return;
  }

  const created = await notificationsRepo.insertNotificationsDeduped(
    [portalAccount.user.id],
    {
      type: PATIENT_PRESCRIPTION_CREATED_TYPE,
      title: PATIENT_PRESCRIPTION_CREATED_TITLE,
      body: PATIENT_PRESCRIPTION_CREATED_BODY,
      entityType: "prescription",
      entityId: input.prescriptionId,
      priority: "important",
    },
  );

  if (created > 0) {
    logger.info(
      {
        prescriptionId: input.prescriptionId,
        recipientUserId: portalAccount.user.id,
        created,
      },
      "patient_prescription_created_notification",
    );
  }
}
