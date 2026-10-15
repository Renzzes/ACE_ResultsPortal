import { Router } from "express";
import {
  messagesRepo,
  notificationsRepo,
  departmentsRepo,
  patientsRepo,
  patientPhysiciansRepo,
  usersRepo,
  withTransaction,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { denyAccess, logAudit } from "../lib/audit";
import {
  canAssociatePatientInMessage,
  canMessageRole,
  filterAuthorizedMessagingUsers,
  isPhysicianRole,
  messagingDepartmentLabel,
} from "../lib/messaging-rbac";
import { openOrCreateDirectThread } from "../lib/direct-thread";
import { deliverConversationDeleted, publishPersistedMessage } from "../lib/message-live";
import { logger } from "../lib/logger";
import {
  RECIPIENT_SEARCH_MIN,
  assertStaffMayMessagePatient,
  messageReceivedNotificationInput,
  optionalMessageBody,
  optionalMessageSubject,
} from "../lib/portal-messaging";

const router = Router();
const SCHEMA_MSG =
  "Messaging schema is not installed. Run docs/migration/sql/007_create_notifications_messaging.sql against ACE_ResultsPortal.";

function displayName(u: { firstName: string; lastName: string; role: string }) {
  if (u.role === "physician") return `Dr. ${u.lastName}, ${u.firstName}`;
  return `${u.lastName}, ${u.firstName}`;
}

router.get("/messages/recipients", requireAuth, async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search.length < RECIPIENT_SEARCH_MIN) {
    res.json([]);
    return;
  }
  const [users, departments] = await Promise.all([
    usersRepo.searchActiveUsers(search, 80),
    departmentsRepo.listDepartments(),
  ]);
  const departmentName = new Map(departments.map((department) => [department.code, department.name]));
  let allowedUsers = filterAuthorizedMessagingUsers(
    { userId: req.user!.userId, role: req.user!.role },
    users,
  );

  // Physicians only see assigned patients among patient-role recipients.
  if (isPhysicianRole(req.user!.role)) {
    const assignedPatientIds = new Set(
      await patientPhysiciansRepo.listAssignedPatientIds(req.user!.userId),
    );
    const filtered = [];
    for (const user of allowedUsers) {
      if (user.role !== "patient") {
        filtered.push(user);
        continue;
      }
      const patient = await patientsRepo.findPatientByPortalUserId(user.id);
      if (patient && assignedPatientIds.has(patient.id)) filtered.push(user);
    }
    allowedUsers = filtered;
  }

  res.json(
    allowedUsers.slice(0, 25).map((u) => ({
      id: u.id,
      name: displayName(u),
      username: u.username,
      role: u.role,
      department: messagingDepartmentLabel(u.role, departmentName.get(u.role) ?? null),
    })),
  );
});

router.get("/messages/unread-count", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.json({ count: 0 });
    return;
  }
  const count = await messagesRepo.countUnreadThreads(req.user!.userId);
  res.json({ count });
});

router.get("/messages/threads", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const result = await messagesRepo.listThreadsForUser(req.user!.userId, { page, limit });

  const enriched = await Promise.all(
    result.data.map(async (t) => {
      const participants = await messagesRepo.listParticipants(t.id);
      const users = await usersRepo.findUsersByIds(participants.map((p) => p.userId));
      const patient = t.patientId ? await patientsRepo.findPatientById(t.patientId) : null;
      return {
        id: t.id,
        subject: t.subject,
        patientId: t.patientId,
        patientName: patient ? `${patient.lastName}, ${patient.firstName}` : null,
        patientHisId: patient?.patientHisId ?? null,
        isClosed: t.isClosed,
        createdById: t.createdById,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        unreadCount: t.unreadCount,
        lastMessagePreview: t.lastMessagePreview,
        lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
        participants: users.map((u) => ({
          id: u.id,
          name: displayName(u),
          role: u.role,
        })),
      };
    }),
  );

  res.json({ data: enriched, total: result.total, page, limit });
});

router.post("/messages/threads", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const subjectResult = optionalMessageSubject(req.body?.subject);
  const bodyResult = optionalMessageBody(req.body?.body);
  const recipientUserId = parseInt(String(req.body?.recipientUserId ?? ""), 10);
  const patientIdRaw = req.body?.patientId;
  const patientId =
    patientIdRaw == null || patientIdRaw === ""
      ? null
      : parseInt(String(patientIdRaw), 10);

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
  if (recipientUserId === req.user!.userId) {
    res.status(400).json({ error: "Cannot message yourself" });
    return;
  }

  const recipient = await usersRepo.findUserById(recipientUserId);
  if (!recipient || !recipient.isActive) {
    res.status(400).json({ error: "Recipient not found or inactive" });
    return;
  }
  if (!canMessageRole(req.user!.role, recipient.role)) {
    await denyAccess(req, res, {
      error: "You don't have permission to perform this action.",
      details: "Unauthorized attempt to message user",
    });
    return;
  }

  let resolvedPatientId = patientId;
  if (recipient.role === "patient") {
    const allowed = await assertStaffMayMessagePatient(
      { userId: req.user!.userId, role: req.user!.role },
      recipientUserId,
    );
    if (!allowed.ok) {
      await denyAccess(req, res, {
        error: "You don't have permission to perform this action.",
        details: "Unauthorized attempt to message patient",
      });
      return;
    }
    // Force clinical ownership to the recipient's patient record (ignore client patientId).
    resolvedPatientId = allowed.patient.id;
  } else if (patientId != null) {
    if (!canAssociatePatientInMessage(req.user!.role)) {
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to attach patient context to message",
      });
      return;
    }
    const patient = await patientsRepo.findPatientById(patientId);
    if (!patient) {
      res.status(400).json({ error: "Patient not found" });
      return;
    }
    if (isPhysicianRole(req.user!.role)) {
      const assignment = await patientPhysiciansRepo.findAssignment(patientId, req.user!.userId);
      if (!assignment) {
        await denyAccess(req, res, {
          error: "Forbidden",
          details: "Unauthorized attempt to attach unassigned patient context",
        });
        return;
      }
    }
  }

  const subject = subjectResult.value ?? displayName(recipient).slice(0, 255);
  let created: {
    id: number;
    subject: string;
    reused: boolean;
    message: { id: number; senderUserId: number; body: string; createdAt: Date } | null;
  };
  try {
    created = await openOrCreateDirectThread({
      actorUserId: req.user!.userId,
      recipientUserId,
      subject,
      body: bodyResult.value,
      patientId: resolvedPatientId,
      audit: async (tx, threadId, reused) => {
        await logAudit(
          {
            action: "edit",
            req,
            userId: req.user!.userId,
            userName: req.user!.username,
            details: reused
              ? `message_thread_reused id=${threadId}`
              : `message_thread_created id=${threadId}`,
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
        recipientUserIds: [req.user!.userId, recipientUserId],
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
});

router.get("/messages/threads/:id", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  const thread = await messagesRepo.findThreadById(id);
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const participant = await messagesRepo.findParticipant(id, req.user!.userId);
  if (!participant) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to access message thread",
    });
    return;
  }
  if (isPhysicianRole(req.user!.role) && thread.patientId != null) {
    const assignment = await patientPhysiciansRepo.findAssignment(
      thread.patientId,
      req.user!.userId,
    );
    if (!assignment) {
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to access patient message thread after assignment revoked",
      });
      return;
    }
  }

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const messages = await messagesRepo.listMessages(id, { page, limit });
  const participants = await messagesRepo.listParticipants(id);
  const users = await usersRepo.findUsersByIds(participants.map((p) => p.userId));
  const patient = thread.patientId ? await patientsRepo.findPatientById(thread.patientId) : null;

  await messagesRepo.markThreadRead(id, req.user!.userId);

  res.json({
    id: thread.id,
    subject: thread.subject,
    patientId: thread.patientId,
    patientName: patient ? `${patient.lastName}, ${patient.firstName}` : null,
    patientHisId: patient?.patientHisId ?? null,
    isClosed: thread.isClosed,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    participants: users.map((u) => ({ id: u.id, name: displayName(u), role: u.role })),
    messages: {
      data: messages.data.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        senderUserId: m.senderUserId,
        senderName: displayName(users.find((u) => u.id === m.senderUserId) ?? { firstName: "User", lastName: String(m.senderUserId), role: "" }),
        body: m.isDeleted ? "Message deleted" : m.body,
        isDeleted: m.isDeleted,
        createdAt: m.createdAt.toISOString(),
      })),
      total: messages.total,
      page,
      limit,
    },
  });
});

router.post("/messages/threads/:id/messages", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  const body = String(req.body?.body ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  if (!body) {
    res.status(400).json({ error: "message body is required" });
    return;
  }

  const thread = await messagesRepo.findThreadById(id);
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const participant = await messagesRepo.findParticipant(id, req.user!.userId);
  if (!participant) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to send message in thread",
    });
    return;
  }
  if (isPhysicianRole(req.user!.role) && thread.patientId != null) {
    const assignment = await patientPhysiciansRepo.findAssignment(
      thread.patientId,
      req.user!.userId,
    );
    if (!assignment) {
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to send in patient thread after assignment revoked",
      });
      return;
    }
  }
  if (thread.isClosed) {
    res.status(400).json({ error: "Thread is closed" });
    return;
  }

  const message = await withTransaction(async (tx) => {
    const row = await messagesRepo.insertMessage(
      { threadId: id, senderUserId: req.user!.userId, body },
      tx,
    );
    const participantIds = (await messagesRepo.listParticipants(id)).map((p) => p.userId);
    const others = participantIds.filter((uid) => uid !== req.user!.userId);
    for (const recipientUserId of others) {
      await notificationsRepo.insertNotification(
        {
          recipientUserId,
          ...messageReceivedNotificationInput(id),
        },
        tx,
      );
    }
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        details: `message_sent threadId=${id}`,
      },
      tx,
    );
    return { row, participantIds };
  });

  try {
    await publishPersistedMessage({
      conversationId: id,
      senderUserId: message.row.senderUserId,
      messageId: message.row.id,
      body: message.row.body,
      createdAt: message.row.createdAt,
      recipientUserIds: message.participantIds,
    });
  } catch (err) {
    logger.error({ err, threadId: id }, "Message live publish failed");
  }

  await messagesRepo.markThreadRead(id, req.user!.userId);
  res.status(201).json({
    id: message.row.id,
    threadId: message.row.threadId,
    senderUserId: message.row.senderUserId,
    body: message.row.body,
    isDeleted: false,
    createdAt: message.row.createdAt.toISOString(),
  });
});

router.post("/messages/threads/:id/read", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  const participant = await messagesRepo.findParticipant(id, req.user!.userId);
  if (!participant) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to mark message thread read",
    });
    return;
  }
  await messagesRepo.markThreadRead(id, req.user!.userId);
  res.json({ ok: true });
});

router.delete("/messages/threads/:id", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  const thread = await messagesRepo.findThreadById(id);
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const participant = await messagesRepo.findParticipant(id, req.user!.userId);
  if (!participant) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to delete message thread",
    });
    return;
  }
  if (isPhysicianRole(req.user!.role) && thread.patientId != null) {
    const assignment = await patientPhysiciansRepo.findAssignment(thread.patientId, req.user!.userId);
    if (!assignment) {
      await denyAccess(req, res, {
        error: "Forbidden",
        details: "Unauthorized attempt to delete patient message thread after assignment revoked",
      });
      return;
    }
  }

  const participantIds = (await messagesRepo.listParticipants(id)).map((row) => row.userId);
  const deleted = await withTransaction(async (tx) => {
    const removed = await messagesRepo.deleteThread(id, tx);
    if (!removed) return false;
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        details: `message_thread_deleted id=${id}`,
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
    deliverConversationDeleted({ conversationId: id, recipientUserIds: participantIds });
  } catch (err) {
    logger.error({ err, threadId: id }, "Conversation delete publish failed");
  }
  res.json({ id });
});

router.post("/messages/threads/:id/close", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid thread id" });
    return;
  }
  const thread = await messagesRepo.findThreadById(id);
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const participant = await messagesRepo.findParticipant(id, req.user!.userId);
  if (!participant) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to close message thread",
    });
    return;
  }
  const closed = await messagesRepo.closeThread(id);
  await logAudit({
    action: "edit",
    req,
    userId: req.user!.userId,
    userName: req.user!.username,
    details: `message_closed threadId=${id}`,
  });
  res.json({ id: closed!.id, isClosed: true });
});

export default router;
