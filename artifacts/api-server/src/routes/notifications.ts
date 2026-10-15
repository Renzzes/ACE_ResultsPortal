import { Router } from "express";
import { notificationsRepo } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { denyAccess } from "../lib/audit";

const router = Router();

const SCHEMA_MSG =
  "Notifications schema is not installed. Run docs/migration/sql/007_create_notifications_messaging.sql against ACE_ResultsPortal.";

function formatNotification(n: {
  id: number;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: number | null;
  priority: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    entityType: n.entityType,
    entityId: n.entityId,
    priority: n.priority,
    isRead: n.isRead,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    expiresAt: n.expiresAt ? n.expiresAt.toISOString() : null,
  };
}

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const unreadOnly = String(req.query.unreadOnly ?? "") === "1" || String(req.query.unreadOnly ?? "") === "true";
  const result = await notificationsRepo.listNotificationsForUser(req.user!.userId, {
    page,
    limit,
    unreadOnly,
  });
  res.json({
    data: result.data.map(formatNotification),
    total: result.total,
    page,
    limit,
  });
});

router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.json({ count: 0 });
    return;
  }
  const count = await notificationsRepo.countUnread(req.user!.userId);
  res.json({ count });
});

router.post("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  const existing = await notificationsRepo.findNotificationForUser(id, req.user!.userId);
  if (!existing) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to mark another user's notification read",
    });
    return;
  }
  const updated = await notificationsRepo.markRead(id, req.user!.userId);
  res.json(formatNotification(updated!));
});

router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const updated = await notificationsRepo.markAllRead(req.user!.userId);
  res.json({ updated });
});

export default router;
