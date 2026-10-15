import { notificationsRepo } from "@workspace/db";
import { logger } from "./logger";

/**
 * Notify the assigned physician that a result copy is available for reference.
 * Does not grant authorization — result_physicians remains authoritative.
 * Does not notify the patient (patient notifications remain release-driven).
 */
export async function notifyResultAssigned(input: {
  resultId: number;
  physicianUserId: number;
}): Promise<void> {
  if (!(await notificationsRepo.messagingSchemaReady())) return;

  const created = await notificationsRepo.insertNotificationsDeduped([input.physicianUserId], {
    type: "result_assigned",
    title: "Result assigned to you",
    body: "A result has been assigned to you for reference.",
    entityType: "result",
    entityId: input.resultId,
    priority: "important",
  });

  logger.info({ resultId: input.resultId, created }, "result_assigned_notification");
}
