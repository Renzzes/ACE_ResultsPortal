/**
 * Patient Portal messaging routes — Phase 6E.
 * Mounted alongside other portal routes via the portal router.
 */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  messagesRepo,
  notificationsRepo,
  usersRepo,
  withTransaction,
} from "@workspace/db";
import { requirePortalAuth } from "../middlewares/auth";
import { denyAccess, logAudit } from "../lib/audit";
import { openOrCreateDirectThread } from "../lib/direct-thread";
import { deliverConversationDeleted, publishPersistedMessage } from "../lib/message-live";
import { logger } from "../lib/logger";
import {
  assertPatientMayMessageRecipient,
  filterPortalRecipientsBySearch,
  listPortalAuthorizedRecipients,
  messageReceivedNotificationInput,
  optionalMessageBody,
  optionalMessageSubject,
  resolvePortalMessagingIdentity,
  sanitizeMessageBody,
} from "../lib/portal-messaging";

const router = Router();

const SCHEMA_MSG =
  "Messaging schema is not installed. Run docs/migration/sql/007_create_notifications_messaging.sql against ACE_ResultsPortal.";

const portalMessageSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Try again later." },
});

function displayName(u: { firstName: string; lastName: string; role: string }) {
  if (u.role === "physician") return `Dr. ${u.lastName}, ${u.firstName}`;
  if (u.role === "medical_records") return "ACE Medical Records";
  if (u.role === "super_admin") return "Patient Support";
  return `${u.lastName}, ${u.firstName}`;
}

async function requirePortalMessagingIdentity(req: Request, res: Response) {
  const identity = await resolvePortalMessagingIdentity(
    Number(req.portalUser!.patientId),
    req.portalUser!.patientHisId,
  );
  if (!identity.ok) {
    res.status(401).json({ error: "Invalid or expired portal session" });
    return null;
  }
  return identity;
}

/** Patient may access a thread only when patient_id matches and they are a participant.
 * Unauthorized access returns 404 (no subject/participants/body leakage).
 */
async function loadAuthorizedPortalThread(
  identity: { patient: { id: number }; portalUserId: number },
  threadId: number,
) {
  const thread = await messagesRepo.findThreadById(threadId);
  if (!thread) return { ok: false as const };
  if (thread.patientId !== identity.patient.id) {
    return { ok: false as const };
  }
  const participant = await messagesRepo.findParticipant(threadId, identity.portalUserId);
  if (!participant) {
    return { ok: false as const };
  }
  return { ok: true as const, thread };
}

router.get("/portal/messages/recipients", requirePortalAuth, async (req, res): Promise<void> => {
  const identity = await requirePortalMessagingIdentity(req, res);
  if (!identity) return;
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const recipients = await listPortalAuthorizedRecipients(identity.patient.id);
  res.json({ data: filterPortalRecipientsBySearch(recipients, search) });
});

router.get("/portal/messages/unread-count", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.json({ count: 0 });
    return;
  }
  const identity = await requirePortalMessagingIdentity(req, res);
  if (!identity) return;
  const count = await messagesRepo.countUnreadThreads(identity.portalUserId);
  res.json({ count });
});

router.get("/portal/messages", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const identity = await requirePortalMessagingIdentity(req, res);
  if (!identity) return;

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const result = await messagesRepo.listThreadsForUser(identity.portalUserId, { page, limit });

  // Only expose threads owned by this patient (defense in depth).
  const owned = result.data.filter((t) => t.patientId === identity.patient.id);

  const enriched = await Promise.all(
    owned.map(async (t) => {
      const participants = await messagesRepo.listParticipants(t.id);
      const users = await usersRepo.findUsersByIds(participants.map((p) => p.userId));
      const counterpart = users.find((u) => u.id !== identity.portalUserId);
      return {
        id: t.id,
        subject: t.subject,
        isClosed: t.isClosed,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        unreadCount: t.unreadCount,
        lastMessagePreview: t.lastMessagePreview,
        lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
        counterpart: counterpart
          ? { name: displayName(counterpart), role: counterpart.role }
          : null,
        participants: users
          .filter((u) => u.id !== identity.portalUserId)
          .map((u) => ({
            name: displayName(u),
            role: u.role,
          })),
      };
    }),
  );

  res.json({ data: enriched, total: enriched.length, page, limit });
});

router.post(
  "/portal/messages/threads",
  requirePortalAuth,
  portalMessageSendLimiter,
  async (req, res): Promise<void> => {
    if (!(await notificationsRepo.messagingSchemaReady())) {
      res.status(503).json({ error: SCHEMA_MSG });
      return;
    }
    const identity = await requirePortalMessagingIdentity(req, res);
    if (!identity) return;

    const subjectResult = optionalMessageSubject(req.body?.subject);
    const bodyResult = optionalMessageBody(req.body?.body);
    const recipientUserId = parseInt(String(req.body?.recipientUserId ?? ""), 10);

    if (!subjectResult.ok) {
      res.status(400).json({ error: "subject is invalid" });
      return;
    }
    if (!bodyResult.ok) {
      res.status(400).json({ error: "message body is invalid" });
      return;
    }
    if (!recipientUserId) {
      res.status(400).json({ error: "recipientUserId is required" });
      return;
    }

    // Ignore client-supplied patientId / senderUserId / participantUserIds entirely.
    void req.body?.patientId;
    void req.body?.senderUserId;
    void req.body?.participantUserIds;
    void req.body?.participants;

    const allowed = await assertPatientMayMessageRecipient(
      identity.patient.id,
      identity.portalUserId,
      recipientUserId,
    );
    if (!allowed.ok) {
      await denyAccess(req, res, {
        error: "You don't have permission to perform this action.",
        details: "Unauthorized portal message recipient",
        patientHisId: identity.patient.patientHisId,
      });
      return;
    }

    const subject = subjectResult.value ?? displayName(allowed.recipient).slice(0, 255);
    let created: {
      id: number;
      subject: string;
      reused: boolean;
      message: { id: number; senderUserId: number; body: string; createdAt: Date } | null;
    };
    try {
      created = await openOrCreateDirectThread({
        actorUserId: identity.portalUserId,
        recipientUserId: allowed.recipient.id,
        subject,
        body: bodyResult.value,
        patientId: identity.patient.id,
        audit: async (tx, threadId, reused) => {
          await logAudit(
            {
              action: "edit",
              req,
              patientHisId: identity.patient.patientHisId,
              details: reused
                ? `portal_message_thread_reused id=${threadId}`
                : `portal_message_thread_created id=${threadId}`,
            },
            tx,
          );
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.startsWith("Could not lock direct conversation")) {
        res.status(503).json({ error: "Could not open conversation. Try again." });
        return;
      }
      throw err;
    }

    if (created.message) {
      try {
        await publishPersistedMessage({
          conversationId: created.id,
          senderUserId: created.message.senderUserId,
          messageId: created.message.id,
          body: created.message.body,
          createdAt: created.message.createdAt,
          recipientUserIds: [identity.portalUserId, allowed.recipient.id],
        });
      } catch (err) {
        logger.error({ err, threadId: created.id }, "Message live publish failed");
      }
    }

    res.status(created.reused ? 200 : 201).json({
      id: created.id,
      subject: created.subject,
      reused: created.reused,
    });
  },
);

router.get("/portal/messages/:threadId", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const identity = await requirePortalMessagingIdentity(req, res);
  if (!identity) return;

  const threadId = parseInt(String(req.params.threadId), 10);
  if (!threadId) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }

  const access = await loadAuthorizedPortalThread(identity, threadId);
  if (!access.ok) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const messages = await messagesRepo.listMessages(threadId, { page, limit });
  const participants = await messagesRepo.listParticipants(threadId);
  const users = await usersRepo.findUsersByIds(participants.map((p) => p.userId));

  await messagesRepo.markThreadRead(threadId, identity.portalUserId);

  res.json({
    id: access.thread.id,
    subject: access.thread.subject,
    isClosed: access.thread.isClosed,
    createdAt: access.thread.createdAt.toISOString(),
    updatedAt: access.thread.updatedAt.toISOString(),
    participants: users
      .filter((u) => u.id !== identity.portalUserId)
      .map((u) => ({ name: displayName(u), role: u.role })),
    messages: {
      data: messages.data.map((m) => {
        const sender = users.find((u) => u.id === m.senderUserId);
        const mine = m.senderUserId === identity.portalUserId;
        return {
          id: m.id,
          threadId: m.threadId,
          mine,
          senderName: mine
            ? "You"
            : displayName(sender ?? { firstName: "User", lastName: "", role: "" }),
          body: m.isDeleted ? "Message deleted" : m.body,
          isDeleted: m.isDeleted,
          createdAt: m.createdAt.toISOString(),
        };
      }),
      total: messages.total,
      page,
      limit,
    },
  });
});

router.post(
  "/portal/messages/:threadId/messages",
  requirePortalAuth,
  portalMessageSendLimiter,
  async (req, res): Promise<void> => {
    if (!(await notificationsRepo.messagingSchemaReady())) {
      res.status(503).json({ error: SCHEMA_MSG });
      return;
    }
    const identity = await requirePortalMessagingIdentity(req, res);
    if (!identity) return;

    const threadId = parseInt(String(req.params.threadId), 10);
    const body = sanitizeMessageBody(req.body?.body);
    if (!threadId) {
      res.status(400).json({ error: "Invalid thread id" });
      return;
    }
    if (!body) {
      res.status(400).json({ error: "message body is required" });
      return;
    }

    const access = await loadAuthorizedPortalThread(identity, threadId);
    if (!access.ok) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }
    if (access.thread.isClosed) {
      res.status(400).json({ error: "This conversation is closed." });
      return;
    }

    // Ignore client-supplied sender_user_id.
    void req.body?.senderUserId;
    void req.body?.sender_user_id;

    const message = await withTransaction(async (tx) => {
      const row = await messagesRepo.insertMessage(
        { threadId, senderUserId: identity.portalUserId, body },
        tx,
      );
      const participantIds = (await messagesRepo.listParticipants(threadId)).map((p) => p.userId);
      const others = participantIds.filter((uid) => uid !== identity.portalUserId);
      for (const recipientUserId of others) {
        await notificationsRepo.insertNotification(
          {
            recipientUserId,
            ...messageReceivedNotificationInput(threadId),
          },
          tx,
        );
      }
      await logAudit(
        {
          action: "edit",
          req,
          patientHisId: identity.patient.patientHisId,
          details: `portal_message_sent threadId=${threadId}`,
        },
        tx,
      );
      return { row, participantIds };
    });

    try {
      await publishPersistedMessage({
        conversationId: threadId,
        senderUserId: message.row.senderUserId,
        messageId: message.row.id,
        body: message.row.body,
        createdAt: message.row.createdAt,
        recipientUserIds: message.participantIds,
      });
    } catch (err) {
      logger.error({ err, threadId }, "Message live publish failed");
    }

    await messagesRepo.markThreadRead(threadId, identity.portalUserId);
    res.status(201).json({
      id: message.row.id,
      threadId: message.row.threadId,
      mine: true,
      body: message.row.body,
      createdAt: message.row.createdAt.toISOString(),
    });
  },
);

router.post("/portal/messages/:threadId/read", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const identity = await requirePortalMessagingIdentity(req, res);
  if (!identity) return;
  const threadId = parseInt(String(req.params.threadId), 10);
  if (!threadId) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  const access = await loadAuthorizedPortalThread(identity, threadId);
  if (!access.ok) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  await messagesRepo.markThreadRead(threadId, identity.portalUserId);
  res.json({ ok: true });
});

router.delete("/portal/messages/:threadId", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const identity = await requirePortalMessagingIdentity(req, res);
  if (!identity) return;
  const threadId = parseInt(String(req.params.threadId), 10);
  if (!threadId) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  const access = await loadAuthorizedPortalThread(identity, threadId);
  if (!access.ok) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const participantIds = (await messagesRepo.listParticipants(threadId)).map((row) => row.userId);
  const deleted = await withTransaction(async (tx) => {
    const removed = await messagesRepo.deleteThread(threadId, tx);
    if (!removed) return false;
    await logAudit(
      {
        action: "edit",
        req,
        patientHisId: identity.patient.patientHisId,
        details: `portal_message_thread_deleted id=${threadId}`,
      },
      tx,
    );
    return true;
  });
  if (!deleted) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  try {
    deliverConversationDeleted({ conversationId: threadId, recipientUserIds: participantIds });
  } catch (err) {
    logger.error({ err, threadId }, "Conversation delete publish failed");
  }
  res.json({ id: threadId });
});

router.post("/portal/messages/:threadId/close", requirePortalAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const identity = await requirePortalMessagingIdentity(req, res);
  if (!identity) return;
  const threadId = parseInt(String(req.params.threadId), 10);
  if (!threadId) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  const access = await loadAuthorizedPortalThread(identity, threadId);
  if (!access.ok) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const closed = await messagesRepo.closeThread(threadId);
  await logAudit({
    action: "edit",
    req,
    patientHisId: identity.patient.patientHisId,
    details: `portal_message_closed threadId=${threadId}`,
  });
  res.json({ id: closed!.id, isClosed: true });
});

export default router;
