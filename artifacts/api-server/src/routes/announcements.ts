import { Router } from "express";
import {
  announcementsRepo,
  notificationsRepo,
  withTransaction,
  type AnnouncementTargetType,
  type NotificationPriority,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { denyAccess, logAudit } from "../lib/audit";
import { canManageAnnouncements } from "../lib/messaging-rbac";

const router = Router();
const SCHEMA_MSG =
  "Announcements schema is not installed. Run docs/migration/sql/007_create_notifications_messaging.sql against ACE_ResultsPortal.";

function formatAnnouncement(
  a: Awaited<ReturnType<typeof announcementsRepo.findAnnouncementById>>,
  targets: Awaited<ReturnType<typeof announcementsRepo.listTargets>> = [],
) {
  if (!a) return null;
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    priority: a.priority,
    createdById: a.createdById,
    isPublished: a.isPublished,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    targets: targets.map((t) => ({
      targetType: t.targetType,
      targetValue: t.targetValue,
    })),
  };
}

async function resolveAudienceUserIds(
  targets: Array<{ targetType: AnnouncementTargetType; targetValue?: string | null }>,
): Promise<number[]> {
  const ids = new Set<number>();
  for (const t of targets) {
    if (t.targetType === "all_staff") {
      for (const id of await notificationsRepo.listActiveStaffUserIds()) ids.add(id);
      for (const id of await notificationsRepo.listActiveAdminUserIds()) ids.add(id);
    } else if (t.targetType === "all_physicians") {
      for (const id of await notificationsRepo.listActivePhysicianUserIds()) ids.add(id);
    } else if (t.targetType === "all_patients") {
      for (const id of await notificationsRepo.listActivePortalPatientUserIds()) ids.add(id);
    } else if (t.targetType === "department" && t.targetValue) {
      for (const id of await notificationsRepo.listActiveDepartmentUserIds(t.targetValue)) ids.add(id);
    }
  }
  return [...ids];
}

router.get("/announcements", requireAuth, async (req, res): Promise<void> => {
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const includeDrafts = canManageAnnouncements(req.user!.role) && String(req.query.includeDrafts ?? "") === "1";
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const result = await announcementsRepo.listAnnouncements({ includeDrafts, page, limit });
  const data = await Promise.all(
    result.data.map(async (a) => formatAnnouncement(a, await announcementsRepo.listTargets(a.id))),
  );
  res.json({ data, total: result.total, page, limit });
});

router.post("/announcements", requireAuth, async (req, res): Promise<void> => {
  if (!canManageAnnouncements(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to create announcement",
    });
    return;
  }
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }

  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  const priority = (String(req.body?.priority ?? "normal") as NotificationPriority) || "normal";
  const targetsRaw = Array.isArray(req.body?.targets) ? req.body.targets : [];
  const expiresAt = req.body?.expiresAt ? new Date(String(req.body.expiresAt)) : null;

  if (!title || title.length > 255 || !body) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }
  if (!["normal", "important", "urgent"].includes(priority)) {
    res.status(400).json({ error: "Invalid priority" });
    return;
  }
  if (targetsRaw.length === 0) {
    res.status(400).json({ error: "At least one target is required" });
    return;
  }

  const targets: Array<{ targetType: AnnouncementTargetType; targetValue?: string | null }> = [];
  for (const t of targetsRaw) {
    const targetType = String(t.targetType ?? "") as AnnouncementTargetType;
    if (!["all_staff", "all_physicians", "department", "all_patients"].includes(targetType)) {
      res.status(400).json({ error: "Invalid target type" });
      return;
    }
    const targetValue = t.targetValue == null ? null : String(t.targetValue).trim();
    if (targetType === "department" && !targetValue) {
      res.status(400).json({ error: "department target requires targetValue" });
      return;
    }
    targets.push({ targetType, targetValue });
  }

  const created = await withTransaction(async (tx) => {
    const row = await announcementsRepo.insertAnnouncement(
      {
        title,
        body,
        priority,
        createdById: req.user!.userId,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      },
      tx,
    );
    await announcementsRepo.replaceTargets(row.id, targets, tx);
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        details: `announcement_created id=${row.id}`,
      },
      tx,
    );
    return row;
  });

  res.status(201).json(formatAnnouncement(created, await announcementsRepo.listTargets(created.id)));
});

router.patch("/announcements/:id", requireAuth, async (req, res): Promise<void> => {
  if (!canManageAnnouncements(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to edit announcement",
    });
    return;
  }
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = await announcementsRepo.findAnnouncementById(id);
  if (!existing) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  if (existing.isPublished) {
    res.status(400).json({ error: "Published announcements cannot be edited" });
    return;
  }

  const updated = await announcementsRepo.updateAnnouncement(id, {
    title: req.body?.title != null ? String(req.body.title).trim() : undefined,
    body: req.body?.body != null ? String(req.body.body).trim() : undefined,
    priority: req.body?.priority,
    expiresAt: req.body?.expiresAt === null ? null : req.body?.expiresAt ? new Date(String(req.body.expiresAt)) : undefined,
  });
  if (Array.isArray(req.body?.targets)) {
    const targets = req.body.targets.map((t: { targetType: string; targetValue?: string }) => ({
      targetType: t.targetType as AnnouncementTargetType,
      targetValue: t.targetValue ?? null,
    }));
    await announcementsRepo.replaceTargets(id, targets);
  }
  res.json(formatAnnouncement(updated, await announcementsRepo.listTargets(id)));
});

router.post("/announcements/:id/publish", requireAuth, async (req, res): Promise<void> => {
  if (!canManageAnnouncements(req.user!.role)) {
    await denyAccess(req, res, {
      error: "Forbidden",
      details: "Unauthorized attempt to publish announcement",
    });
    return;
  }
  if (!(await notificationsRepo.messagingSchemaReady())) {
    res.status(503).json({ error: SCHEMA_MSG });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = await announcementsRepo.findAnnouncementById(id);
  if (!existing) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  if (existing.isPublished) {
    res.status(400).json({ error: "Already published" });
    return;
  }
  if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "Announcement has expired" });
    return;
  }

  const targets = await announcementsRepo.listTargets(id);
  if (targets.length === 0) {
    res.status(400).json({ error: "Announcement has no targets" });
    return;
  }

  const published = await withTransaction(async (tx) => {
    const row = await announcementsRepo.publishAnnouncement(id, tx);
    if (!row) return null;
    const recipientIds = await resolveAudienceUserIds(
      targets.map((t) => ({ targetType: t.targetType, targetValue: t.targetValue })),
    );
    await notificationsRepo.insertNotificationsDeduped(
      recipientIds,
      {
        type: "announcement",
        title: row.title.slice(0, 255),
        body: "A new announcement has been published.",
        entityType: "announcement",
        entityId: row.id,
        priority: row.priority,
        expiresAt: row.expiresAt,
      },
      tx,
    );
    await logAudit(
      {
        action: "edit",
        req,
        userId: req.user!.userId,
        userName: req.user!.username,
        details: `announcement_published id=${row.id} recipients=${recipientIds.length}`,
      },
      tx,
    );
    return row;
  });

  if (!published) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  res.json(formatAnnouncement(published, targets));
});

export default router;
