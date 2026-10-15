/**
 * Physician Patient Results — KPI / filter helpers.
 * Uses authorized listResults only. Does not invent clinical demographics.
 */

import { listResults, type Result } from "@workspace/api-client-react";

export type DoctorResultStats = {
  total: number;
  released: number;
  /** Results where this physician has not yet saved a review. Null if review payloads are unavailable. */
  pendingReview: number | null;
  /** Privately assigned results still in pending status. */
  requiresAttention: number;
};

const STATS_PAGE = 100;
const STATS_MAX_PAGES = 10;

export function isReleased(result: Result): boolean {
  return (result.status ?? "") === "released";
}

export function isPendingStatus(result: Result): boolean {
  return (result.status ?? "") === "pending";
}

export function isAwaitingReview(result: Result): boolean | null {
  if (result.myReview == null) return null;
  return result.myReview.reviewed !== true;
}

export async function fetchDoctorResultStats(): Promise<DoctorResultStats> {
  const first = await listResults({ page: 1, limit: STATS_PAGE });
  const total = first.total ?? 0;
  const pages = Math.min(STATS_MAX_PAGES, Math.max(1, Math.ceil(total / STATS_PAGE) || 1));
  let rows: Result[] = [...(first.data ?? [])];
  for (let page = 2; page <= pages; page += 1) {
    const next = await listResults({ page, limit: STATS_PAGE });
    rows = rows.concat(next.data ?? []);
  }

  let released = 0;
  let pendingReview = 0;
  let requiresAttention = 0;
  let reviewKnown = 0;
  for (const row of rows) {
    if (isReleased(row)) released += 1;
    if (isPendingStatus(row)) requiresAttention += 1;
    const awaiting = isAwaitingReview(row);
    if (awaiting != null) {
      reviewKnown += 1;
      if (awaiting) pendingReview += 1;
    }
  }

  return {
    total,
    released,
    pendingReview: reviewKnown > 0 ? pendingReview : null,
    requiresAttention,
  };
}

export function resultInDateBucket(
  iso: string | null | undefined,
  bucket: string,
): boolean {
  if (bucket === "all") return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (bucket === "today") return d >= startToday;
  if (bucket === "7d") {
    const from = new Date(startToday);
    from.setDate(from.getDate() - 7);
    return d >= from;
  }
  if (bucket === "30d") {
    const from = new Date(startToday);
    from.setDate(from.getDate() - 30);
    return d >= from;
  }
  return true;
}
