import { notificationsRepo } from "@workspace/db";
import { logger } from "./logger";

/** After a successful result upload, notify assigned physicians and admins. */
export async function notifyResultUploaded(input: {
  resultId: number;
  patientId: number;
  category: string;
  uploaderUserId: number;
}): Promise<void> {
  if (!(await notificationsRepo.messagingSchemaReady())) return;

  const physicianIds = await notificationsRepo.listActiveAssignedPhysicianIds(input.patientId);
  const adminIds = await notificationsRepo.listActiveAdminUserIds();
  const recipients = [...physicianIds, ...adminIds].filter((id) => id !== input.uploaderUserId);

  if (recipients.length === 0) return;

  const created = await notificationsRepo.insertNotificationsDeduped(recipients, {
    type: "result_uploaded",
    title: "New Result Available",
    body: "A new diagnostic result has been uploaded for a patient assigned to you.",
    entityType: "result",
    entityId: input.resultId,
    priority: "important",
  });

  logger.info(
    { resultId: input.resultId, created, recipients: recipients.length },
    "result_upload_notifications",
  );
}
