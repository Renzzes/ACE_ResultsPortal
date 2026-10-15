import {
  resultPhysiciansRepo,
  resultReviewsRepo,
  ResultReviewSchemaError,
  usersRepo,
  type ResultRow,
} from "@workspace/db";
import type { AuthUser } from "../middlewares/auth";
import { canAccessResult, type ResultAccessDeps } from "./result-access";

export const RESULT_REVIEW_SCHEMA_MESSAGE =
  "Physician review storage is not installed. Run docs/migration/sql/014_result_reviews.sql against ACE_ResultsPortal.";

export const MAX_REVIEW_COMMENT_LENGTH = 4000;

export type StoredReview = {
  resultId: number;
  physicianId: number;
  comment: string | null;
  reviewedAt: string;
};

export type StaffReviewView = {
  physicianId: number;
  physicianName: string;
  reviewed: boolean;
  reviewedAt: string | null;
  comment: string | null;
};

export type PhysicianReviewView = {
  reviewed: boolean;
  reviewedAt: string | null;
  comment: string | null;
};

export function parseReviewComment(value: unknown): { ok: true; comment: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, comment: null };
  if (typeof value !== "string") return { ok: false, error: "Invalid comment" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, comment: null };
  if (trimmed.length > MAX_REVIEW_COMMENT_LENGTH) {
    return { ok: false, error: `Comment must be at most ${MAX_REVIEW_COMMENT_LENGTH} characters.` };
  }
  return { ok: true, comment: trimmed };
}

/** Assigned physicians left-joined to their own review. One physician does not mark the result reviewed for the others. */
export function staffReviewViews(
  assigned: readonly { physicianId: number; physicianName: string }[],
  reviews: readonly { physicianId: number; comment: string | null; reviewedAt: string }[],
): StaffReviewView[] {
  const byPhysician = new Map(reviews.map((review) => [review.physicianId, review]));
  const seen = new Set<number>();
  const rows: StaffReviewView[] = [];
  for (const physician of assigned) {
    if (seen.has(physician.physicianId)) continue;
    seen.add(physician.physicianId);
    const review = byPhysician.get(physician.physicianId);
    rows.push({
      physicianId: physician.physicianId,
      physicianName: physician.physicianName,
      reviewed: Boolean(review),
      reviewedAt: review?.reviewedAt ?? null,
      comment: review?.comment ?? null,
    });
  }
  return rows;
}

export function physicianReviewView(
  review: { comment: string | null; reviewedAt: string } | null | undefined,
): PhysicianReviewView {
  if (!review) return { reviewed: false, reviewedAt: null, comment: null };
  return { reviewed: true, reviewedAt: review.reviewedAt, comment: review.comment };
}

/**
 * In-memory upsert used to specify review identity.
 * The database path is MERGE on (result_id, physician_id) and stamps reviewed_at on the server.
 */
export function applyReviewUpsert(
  rows: readonly StoredReview[],
  input: { resultId: number; physicianId: number; comment: string | null; reviewedAt: string },
): StoredReview[] {
  const next = rows.map((row) => ({ ...row }));
  const index = next.findIndex((row) => row.resultId === input.resultId && row.physicianId === input.physicianId);
  const saved: StoredReview = {
    resultId: input.resultId,
    physicianId: input.physicianId,
    comment: input.comment,
    reviewedAt: input.reviewedAt,
  };
  if (index === -1) next.push(saved);
  else next[index] = saved;
  return next;
}

/** Reviewer identity is the authenticated user. Body physicianId is never used. */
export function sessionReviewerId(userId: number): number {
  return userId;
}

/**
 * Staff responses include every assigned physician, reviewed or not.
 * Physician responses include only that physician's review.
 * A missing result_reviews table omits both fields instead of inventing "not reviewed".
 */
export async function loadReviewExtras(
  resultId: number,
  viewer: { role: string; userId: number },
  assignedPhysicians?: Array<{ id: number; name: string }>,
): Promise<{ reviews?: StaffReviewView[]; myReview?: PhysicianReviewView }> {
  if (viewer.role === "patient") return {};
  if (!(await resultReviewsRepo.schemaReady())) return {};
  try {
    if (viewer.role === "physician") {
      const own = await resultReviewsRepo.getReviewForPhysician(resultId, viewer.userId);
      return {
        myReview: physicianReviewView(
          own ? { comment: own.comment, reviewedAt: own.reviewedAt.toISOString() } : null,
        ),
      };
    }
    const assigned = assignedPhysicians
      ?? await assignedPhysicianNames(resultId);
    const saved = await resultReviewsRepo.getReviewsForResult(resultId);
    return {
      reviews: staffReviewViews(
        assigned.map((physician) => ({ physicianId: physician.id, physicianName: physician.name })),
        saved.map((review) => ({
          physicianId: review.physicianId,
          comment: review.comment,
          reviewedAt: review.reviewedAt.toISOString(),
        })),
      ),
    };
  } catch (err) {
    if (err instanceof ResultReviewSchemaError) return {};
    throw err;
  }
}

async function assignedPhysicianNames(resultId: number): Promise<Array<{ id: number; name: string }>> {
  const ids = await resultPhysiciansRepo.listPhysicianIdsForResult(resultId);
  const rows = await Promise.all(ids.map(async (physicianId) => {
    const doctor = await usersRepo.findUserById(physicianId);
    return doctor
      ? { id: doctor.id, name: `Dr. ${doctor.lastName}, ${doctor.firstName}` }
      : null;
  }));
  return rows.filter((row): row is { id: number; name: string } => row != null);
}

export async function authorizePhysicianReview(
  user: AuthUser,
  result: ResultRow,
  deps?: Partial<ResultAccessDeps>,
): Promise<{ ok: true } | { ok: false; status: 403; error: string }> {
  if (user.role !== "physician") {
    return { ok: false, status: 403, error: "Not authorized to review this result" };
  }
  if (!(await canAccessResult(user, result, deps))) {
    return { ok: false, status: 403, error: "Not authorized to review this result" };
  }
  return { ok: true };
}
