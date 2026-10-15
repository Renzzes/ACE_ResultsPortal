import { notificationsRepo } from "@workspace/db";
import { logger } from "./logger";

function staffRolesForCategory(category: string): string[] {
  const code = category.trim().toLowerCase();
  if (code === "laboratory") return ["laboratory"];
  if (code === "other") return ["endoscopy"];
  return ["radiology"];
}

/**
 * When a physician saves a review comment, notify Staff Desk users
 * (department staff, uploader, medical records / admins). Review persistence
 * remains authoritative if notify fails.
 */
export async function notifyStaffOfPhysicianReview(input: {
  resultId: number;
  patientId: number;
  category: string;
  physicianUserId: number;
  physicianName: string;
  comment: string | null;
  uploadedById: number | null;
}): Promise<void> {
  const comment = (input.comment ?? "").trim();
  if (!comment) return;
  if (!(await notificationsRepo.messagingSchemaReady())) return;

  const departmentIds = (
    await Promise.all(
      staffRolesForCategory(input.category).map((role) =>
        notificationsRepo.listActiveDepartmentUserIds(role),
      ),
    )
  ).flat();
  const adminIds = await notificationsRepo.listActiveAdminUserIds();
  const recipients = new Set<number>([...departmentIds, ...adminIds]);
  if (input.uploadedById != null) recipients.add(input.uploadedById);
  recipients.delete(input.physicianUserId);

  if (recipients.size === 0) return;

  const preview = comment.length > 160 ? `${comment.slice(0, 157)}…` : comment;
  let created = 0;
  for (const recipientUserId of recipients) {
    await notificationsRepo.insertNotification({
      recipientUserId,
      type: "result_reviewed",
      title: "Doctor comment on result",
      body: `${input.physicianName} left a review comment: ${preview}`,
      entityType: "result",
      entityId: input.resultId,
      priority: "important",
    });
    created += 1;
  }

  logger.info(
    { resultId: input.resultId, created, recipients: recipients.size },
    "result_review_comment_notifications",
  );
}
