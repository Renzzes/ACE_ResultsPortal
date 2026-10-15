/**
 * Open an existing 1-to-1 thread or create exactly one.
 * Caller must already have authorized the recipient.
 * Pair creation is serialized with sp_getapplock inside the transaction.
 */
import { messagesRepo, notificationsRepo, withTransaction, type DbTransaction } from "@workspace/db";
import { messageReceivedNotificationInput } from "./portal-messaging";

export async function openOrCreateDirectThread(input: {
  actorUserId: number;
  recipientUserId: number;
  subject: string;
  body: string | null;
  patientId: number | null;
  audit: (tx: DbTransaction, threadId: number, reused: boolean) => Promise<void>;
}): Promise<{
  id: number;
  subject: string;
  reused: boolean;
  message: { id: number; senderUserId: number; body: string; createdAt: Date } | null;
}> {
  return withTransaction(async (tx) => {
    await messagesRepo.acquireDirectPairLock(input.actorUserId, input.recipientUserId, tx);
    const existing = await messagesRepo.findOpenDirectThread(
      input.actorUserId,
      input.recipientUserId,
      tx,
    );
    if (existing) {
      let message: { id: number; senderUserId: number; body: string; createdAt: Date } | null = null;
      if (input.body) {
        const row = await messagesRepo.insertMessage(
          { threadId: existing.id, senderUserId: input.actorUserId, body: input.body },
          tx,
        );
        message = {
          id: row.id,
          senderUserId: row.senderUserId,
          body: row.body,
          createdAt: row.createdAt,
        };
        await notificationsRepo.insertNotification(
          {
            recipientUserId: input.recipientUserId,
            ...messageReceivedNotificationInput(existing.id),
          },
          tx,
        );
      } else {
        await messagesRepo.touchThread(existing.id, tx);
      }
      await input.audit(tx, existing.id, true);
      return { id: existing.id, subject: existing.subject, reused: true, message };
    }

    const { thread, firstMessage } = await messagesRepo.createThread(
      {
        subject: input.subject,
        patientId: input.patientId,
        createdById: input.actorUserId,
        participantUserIds: [input.recipientUserId],
        firstMessageBody: input.body ?? undefined,
      },
      tx,
    );
    if (firstMessage) {
      await notificationsRepo.insertNotification(
        {
          recipientUserId: input.recipientUserId,
          ...messageReceivedNotificationInput(thread.id),
        },
        tx,
      );
    }
    await input.audit(tx, thread.id, false);
    return {
      id: thread.id,
      subject: thread.subject,
      reused: false,
      message: firstMessage
        ? {
            id: firstMessage.id,
            senderUserId: firstMessage.senderUserId,
            body: firstMessage.body,
            createdAt: firstMessage.createdAt,
          }
        : null,
    };
  });
}
