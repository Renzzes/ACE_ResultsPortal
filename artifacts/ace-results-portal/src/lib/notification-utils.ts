import type { PortalNotification } from "@/lib/comms-api";

export function notificationHref(
  n: Pick<PortalNotification, "type" | "entityType" | "entityId">,
  role: string,
): string {
  const isPhysician = role === "physician";
  const isAdmin = role === "super_admin";
  const isPatient = role === "patient" || role === "portal";

  if (isPatient) {
    if (n.type === "prescription_created" || n.entityType === "prescription") {
      return n.entityId ? `/portal/medications?prescriptionId=${n.entityId}` : "/portal/medications";
    }
    if (n.type === "result_released" || n.entityType === "result") {
      return n.entityId ? `/portal/results?resultId=${n.entityId}` : "/portal/results";
    }
    if (n.type === "message_received" || n.entityType === "message" || n.entityType === "thread") {
      if (n.entityType === "thread" && n.entityId) {
        return `/portal/messages?threadId=${n.entityId}`;
      }
      return "/portal/messages";
    }
    return "/portal/notifications";
  }

  if (
    n.type === "result_uploaded" ||
    n.type === "result_released" ||
    n.type === "result_assigned" ||
    n.type === "result_reviewed" ||
    n.entityType === "result"
  ) {
    if (isPhysician) {
      return n.entityId ? `/physician/results?resultId=${n.entityId}` : "/physician/results";
    }
    if (isAdmin) return "/admin/results";
    return n.entityId ? `/results/${n.entityId}` : "/results";
  }
  if (n.type === "message_received" || n.entityType === "message" || n.entityType === "thread") {
    const threadQuery = n.entityType === "thread" && n.entityId ? `?threadId=${n.entityId}` : "";
    if (isPhysician) return `/physician/messages${threadQuery}`;
    if (isAdmin) return `/admin/messages${threadQuery}`;
    return `/messages${threadQuery}`;
  }
  if (n.type === "access_code_requested" || (n.entityType === "patient" && n.type === "access_code_requested")) {
    if (isAdmin) return "/admin/patients";
    return "/patients";
  }
  if (n.type === "announcement" || n.entityType === "announcement") {
    if (isAdmin) return "/admin/announcements";
    return isPhysician ? "/physician/overview" : "/dashboard";
  }
  return isPhysician ? "/physician/overview" : isAdmin ? "/admin" : "/dashboard";
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function priorityDotClass(priority: string): string {
  if (priority === "urgent") return "bg-red-600";
  if (priority === "important") return "bg-amber-500";
  return "bg-slate-400";
}
