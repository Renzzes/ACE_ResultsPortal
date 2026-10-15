import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CloudUpload,
  FileText,
  FolderCheck,
  MessageSquareText,
  MoreVertical,
  Search,
  Stethoscope,
  UserPlus,
} from "lucide-react";
import type {
  StaffDeskOverview,
  StaffDeskPatient,
  StaffDeskResult,
  StaffDeskReview,
} from "@/lib/staff-dashboard-api";
import { formatRelativeTime } from "@/lib/notification-utils";

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory",
  radiology: "Radiology",
  ultrasound: "Ultrasound",
  ct_scan: "CT Scan",
  mri: "MRI",
  ecg: "ECG",
  echo_2d: "Echo",
  rehabilitation: "Rehabilitation",
  other: "Other",
};

function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, " ");
}

function patientDisplayName(patient: StaffDeskPatient) {
  return `${patient.lastName}, ${patient.firstName}`.replace(/^,\s*|,\s*$/g, "").trim();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[hsl(var(--st-green-soft))] ${className ?? ""}`} />;
}

export function SummaryMetricCards({
  pending,
  reviewedToday,
  uploadedToday,
  loading,
}: {
  pending: number;
  reviewedToday: number;
  uploadedToday: number;
  loading?: boolean;
}) {
  const cards = [
    {
      key: "pending",
      label: "Pending Review",
      value: pending,
      hint: "Results awaiting doctor review",
      href: "/results",
      icon: Clock3,
      iconWrap: "bg-[hsl(var(--st-maroon-soft))] text-[hsl(var(--st-maroon))]",
    },
    {
      key: "reviewed",
      label: "Reviewed Today",
      value: reviewedToday,
      hint: "Results reviewed by doctors today",
      href: "/results",
      icon: CheckCircle2,
      iconWrap: "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))]",
    },
    {
      key: "uploaded",
      label: "Uploaded Today",
      value: uploadedToday,
      hint: "Results uploaded today",
      href: "/results",
      icon: CloudUpload,
      iconWrap: "bg-[hsl(210_60%_94%)] text-[hsl(210_55%_40%)]",
    },
  ] as const;

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[7.5rem] sm:h-[8.75rem]" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.key}
            href={card.href}
            className="st-card group relative flex min-h-[7rem] items-center gap-3 rounded-[1.2rem] px-4 py-4 no-underline shadow-[0_10px_28px_rgb(20_40_28/0.08)] transition-colors hover:border-[hsl(var(--st-green))]/35 sm:min-h-[8.75rem] sm:gap-5 sm:px-5 sm:py-5"
          >
            <div
              className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[1rem] sm:h-[4.25rem] sm:w-[4.25rem] sm:rounded-[1.15rem] ${card.iconWrap}`}
            >
              <Icon className="h-6 w-6 stroke-[2.25] sm:h-8 sm:w-8" />
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <p className="text-sm font-semibold text-[hsl(var(--st-text))]">{card.label}</p>
              <p className="mt-1 text-3xl font-bold leading-none tracking-tight text-[hsl(var(--st-text))] sm:mt-1.5 sm:text-4xl">
                {card.value}
              </p>
              <p className="mt-1.5 text-xs st-muted sm:mt-2">{card.hint}</p>
            </div>
            <span className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--st-border))] text-[hsl(var(--st-muted))] transition-colors group-hover:border-[hsl(var(--st-green))] group-hover:text-[hsl(var(--st-green))] sm:right-4 sm:top-4">
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

type TimelineEvent =
  | {
      key: string;
      kind: "review";
      at: string;
      review: StaffDeskReview;
    }
  | {
      key: string;
      kind: "upload";
      at: string;
      result: StaffDeskResult;
    }
  | {
      key: string;
      kind: "register";
      at: string;
      patient: StaffDeskPatient;
    };

const KIND_RANK: Record<TimelineEvent["kind"], number> = {
  review: 0,
  upload: 1,
  register: 2,
};

function eventTimeMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Newest first. Doctor reviews/comments always beat uploads/registers when times tie. */
function buildTimeline(desk: StaffDeskOverview): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...(desk.recentReviews ?? []).map((review) => ({
      key: `review-${review.id}-${review.reviewedAt}`,
      kind: "review" as const,
      at: review.reviewedAt,
      review,
    })),
    ...desk.recentResults.map((result) => ({
      key: `upload-${result.id}`,
      kind: "upload" as const,
      at: result.uploadedAt,
      result,
    })),
    ...desk.recentPatients.map((patient) => ({
      key: `register-${patient.id}`,
      kind: "register" as const,
      at: patient.createdAt,
      patient,
    })),
  ];
  return events
    .sort((a, b) => {
      const byTime = eventTimeMs(b.at) - eventTimeMs(a.at);
      if (byTime !== 0) return byTime;
      if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (a.kind === "review" && b.kind === "review") {
        const aComment = a.review.comment?.trim() ? 1 : 0;
        const bComment = b.review.comment?.trim() ? 1 : 0;
        return bComment - aComment;
      }
      return 0;
    })
    .slice(0, 12);
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "blue" | "purple" | "amber";
}) {
  const tones = {
    green: "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))]",
    blue: "bg-[hsl(210_60%_94%)] text-[hsl(210_55%_38%)]",
    purple: "bg-[hsl(275_45%_94%)] text-[hsl(275_40%_40%)]",
    amber: "bg-[hsl(38_70%_92%)] text-[hsl(32_55%_36%)]",
  } as const;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {label}
    </span>
  );
}

export function RecentActivityPanel({
  desk,
  loading,
}: {
  desk?: StaffDeskOverview;
  loading?: boolean;
}) {
  const events = useMemo(() => (desk ? buildTimeline(desk) : []), [desk]);
  const viewAllHref = "/results";
  const knownKeysRef = useRef<Set<string>>(new Set());
  const [freshKeys, setFreshKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (loading || events.length === 0) return;
    const nextKeys = new Set(events.map((event) => event.key));
    const known = knownKeysRef.current;
    if (known.size === 0) {
      knownKeysRef.current = nextKeys;
      return;
    }
    const arrived = new Set([...nextKeys].filter((key) => !known.has(key)));
    knownKeysRef.current = nextKeys;
    if (arrived.size === 0) return;
    setFreshKeys(arrived);
    const timer = window.setTimeout(() => setFreshKeys(new Set()), 30_000);
    return () => window.clearTimeout(timer);
  }, [events, loading]);

  return (
    <section className="st-card flex min-h-[20rem] flex-col overflow-hidden rounded-[1.15rem] px-4 py-4 sm:min-h-[28rem] sm:px-5 sm:py-5">
      <div className="mb-4 flex flex-shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-[hsl(var(--st-green))]" />
            <h2 className="text-base font-semibold text-[hsl(var(--st-text))]">Recent Activity</h2>
          </div>
          <p className="mt-0.5 text-[11px] st-muted">
            Live · newest first · doctor comments rise to the top
          </p>
        </div>
        <Link href={viewAllHref} className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline hover:underline">
          View all →
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <FolderCheck className="h-10 w-10 text-[hsl(var(--st-green))]/50" />
          <p className="text-sm font-semibold text-[hsl(var(--st-text))]">No recent desk activity</p>
          <p className="text-xs st-muted">Uploads, reviews, and registrations will appear here.</p>
        </div>
      ) : (
        <ul className="st-scroll relative min-h-0 flex-1 space-y-0 overflow-y-auto pr-1">
          {/* Centered on 44px markers (left + half width − half line) */}
          <span
            className="pointer-events-none absolute bottom-4 left-[1.3125rem] top-4 z-0 w-[2px] rounded-full bg-[hsl(var(--st-green))]/35"
            aria-hidden
          />
          {events.map((event) => (
            <li
              key={event.key}
              className={`relative z-[1] flex gap-4 pb-5 last:pb-1 ${
                freshKeys.has(event.key) ? "animate-in fade-in slide-in-from-top-2 duration-500" : ""
              }`}
            >
              <TimelineMarker kind={event.kind} />
              <div className="min-w-0 flex-1">
                {event.kind === "review" ? (
                  <ReviewEvent review={event.review} isFresh={freshKeys.has(event.key)} />
                ) : null}
                {event.kind === "upload" ? (
                  <UploadEvent result={event.result} isFresh={freshKeys.has(event.key)} />
                ) : null}
                {event.kind === "register" ? <RegisterEvent patient={event.patient} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TimelineMarker({ kind }: { kind: TimelineEvent["kind"] }) {
  const styles = {
    review: "bg-[hsl(var(--st-green-soft))] text-[hsl(var(--st-green))] ring-[hsl(var(--st-card))]",
    upload: "bg-[hsl(210_60%_94%)] text-[hsl(210_55%_40%)] ring-[hsl(var(--st-card))]",
    register: "bg-[hsl(275_45%_94%)] text-[hsl(275_40%_40%)] ring-[hsl(var(--st-card))]",
  } as const;
  const Icon = kind === "review" ? Stethoscope : kind === "upload" ? CloudUpload : UserPlus;
  return (
    <span
      className={`relative z-[1] flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ring-4 ${styles[kind]}`}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function ReviewEvent({ review, isFresh }: { review: StaffDeskReview; isFresh?: boolean }) {
  const hasComment = Boolean(review.comment?.trim());
  const resultHref = `/results/${review.resultId}`;
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        isFresh
          ? "border-[hsl(var(--st-green))] bg-[hsl(var(--st-green-soft))]/40 shadow-sm"
          : "border-[hsl(var(--st-border))] bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[hsl(var(--st-text))]">
              {hasComment
                ? `${review.physicianName} left a comment`
                : `${review.physicianName} reviewed a result`}
            </p>
            {isFresh ? <StatusBadge label="New" tone="green" /> : null}
          </div>
          <p className="mt-0.5 text-xs st-muted">
            {review.patientName} · {categoryLabel(review.category)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] st-muted" title={formatDateTime(review.reviewedAt)}>
            {formatRelativeTime(review.reviewedAt) || formatTime(review.reviewedAt)}
          </span>
          <StatusBadge label={hasComment ? "Comment" : "Reviewed"} tone="green" />
        </div>
      </div>
      {hasComment ? (
        <div className="mt-3 flex gap-2.5 rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 py-2.5">
          <MessageSquareText className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--st-green))]" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide st-muted">Doctor&apos;s Comment</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm italic text-[hsl(var(--st-text))]">
              &ldquo;{review.comment}&rdquo;
            </p>
          </div>
        </div>
      ) : null}
      {review.originalFileName ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 flex-shrink-0 text-[hsl(var(--st-maroon))]" />
            <span className="truncate text-xs font-medium text-[hsl(var(--st-text))]">{review.originalFileName}</span>
          </div>
          <Link href={resultHref} className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline">
            View
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function UploadEvent({ result, isFresh }: { result: StaffDeskResult; isFresh?: boolean }) {
  const resultHref = `/results/${result.id}`;
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        isFresh
          ? "border-[hsl(210_55%_70%)] bg-[hsl(210_60%_96%)] shadow-sm"
          : "border-[hsl(var(--st-border))] bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[hsl(var(--st-text))]">Result uploaded</p>
            {isFresh ? <StatusBadge label="New" tone="blue" /> : null}
          </div>
          <p className="mt-0.5 text-xs st-muted">
            {result.patientName} · {categoryLabel(result.category)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] st-muted" title={formatDateTime(result.uploadedAt)}>
            {formatRelativeTime(result.uploadedAt) || formatTime(result.uploadedAt)}
          </span>
          <StatusBadge label="Uploaded" tone="blue" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-[hsl(var(--st-border))] bg-white px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 flex-shrink-0 text-[hsl(210_55%_40%)]" />
          <span className="truncate text-xs font-medium text-[hsl(var(--st-text))]">
            {result.originalFileName || `Result #${result.id}`}
          </span>
        </div>
        <Link href={resultHref} className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline">
          View
        </Link>
      </div>
    </div>
  );
}

function RegisterEvent({ patient }: { patient: StaffDeskPatient }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--st-border))] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[hsl(var(--st-text))]">Patient registered</p>
          <p className="mt-0.5 text-xs st-muted">
            {patientDisplayName(patient)} · {patient.patientHisId}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] st-muted">{formatTime(patient.createdAt)}</span>
          <StatusBadge label="Registered" tone="purple" />
        </div>
      </div>
      <div className="mt-2">
        <Link href={`/patients/${patient.id}`} className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline">
          Open patient →
        </Link>
      </div>
    </div>
  );
}

export function ResultsRequiringActionPanel({
  pending,
  loading,
}: {
  pending: StaffDeskResult[];
  loading?: boolean;
}) {
  return (
    <section className="st-card flex min-h-[20rem] flex-col overflow-hidden rounded-[1.15rem] px-4 py-4 sm:min-h-[28rem] sm:px-5 sm:py-5">
      <div className="mb-1 flex flex-shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[hsl(var(--st-maroon))]" />
          <h2 className="text-base font-semibold text-[hsl(var(--st-text))]">Results Requiring Action</h2>
        </div>
        <Link href="/results" className="text-xs font-semibold text-[hsl(var(--st-green))] no-underline hover:underline">
          View all →
        </Link>
      </div>
      <p className="mb-4 text-xs st-muted">
        Results that need doctor review, correction, or other staff action.
      </p>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : pending.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-[hsl(var(--st-green-soft))]">
            <FolderCheck className="h-12 w-12 text-[hsl(var(--st-green))]" />
          </div>
          <p className="text-lg font-semibold text-[hsl(var(--st-text))]">You're all caught up!</p>
          <p className="max-w-[16rem] text-sm st-muted">
            No other results currently require your attention.
          </p>
        </div>
      ) : (
        <ul className="st-scroll min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {pending.map((item) => (
            <li key={item.id}>
              <Link
                href="/results"
                className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--st-border))] bg-white px-3 py-3 no-underline transition-colors hover:border-[hsl(var(--st-green))]/40 hover:bg-[hsl(var(--st-cream))]"
              >
                <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--st-maroon-soft))] text-[hsl(var(--st-maroon))]">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[hsl(var(--st-text))]">
                    {item.originalFileName || categoryLabel(item.category)}
                  </p>
                  <p className="mt-0.5 truncate text-xs st-muted">
                    {item.patientName} · {categoryLabel(item.category)}
                  </p>
                  <p className="mt-1 text-[11px] st-muted">{formatDateTime(item.uploadedAt)}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge label="Pending Review" tone="amber" />
                  <ArrowRight className="h-4 w-4 text-[hsl(var(--st-muted))]" />
                </div>
              </Link>
            </li>
          ))}
          {pending.length > 0 ? (
            <li className="pt-6">
              <CaughtUpFooter />
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function CaughtUpFooter() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--st-green-soft))]">
        <FolderCheck className="h-8 w-8 text-[hsl(var(--st-green))]" />
      </div>
      <p className="text-sm font-semibold text-[hsl(var(--st-text))]">You're all caught up!</p>
      <p className="text-xs st-muted">No other results currently require your attention.</p>
    </div>
  );
}

export function DeskErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="st-card flex min-h-[20rem] flex-col items-center justify-center gap-3 rounded-[1.15rem] px-6 text-center">
      <p className="text-sm font-semibold text-[hsl(var(--st-text))]">Unable to load dashboard data.</p>
      <p className="text-xs st-muted">Check that the API is running, then try again.</p>
      <button
        type="button"
        className="rounded-full bg-[hsl(var(--st-green))] px-4 py-2 text-sm font-semibold text-white"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

export function DeskPrimaryActions({
  canRegister,
  canUpload,
}: {
  canRegister: boolean;
  canUpload: boolean;
}): ReactNode {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
      {canRegister ? (
        <Link
          href="/patients/new"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--st-border))] bg-white px-4 py-2.5 text-sm font-semibold text-[hsl(var(--st-text))] no-underline shadow-sm hover:border-[hsl(var(--st-green))]/40 sm:w-auto"
        >
          <UserPlus className="h-4 w-4" />
          Register Patient
        </Link>
      ) : null}
      {canUpload ? (
        <Link
          href="/results/upload"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--st-green))] px-4 py-2.5 text-sm font-semibold text-white no-underline shadow-sm hover:opacity-95 sm:w-auto"
        >
          <CloudUpload className="h-4 w-4" />
          Upload Result
        </Link>
      ) : null}
    </div>
  );
}

type AppointmentFilter = "all" | "scheduled" | "in_progress" | "completed";

/**
 * ShanScheduler appointments UI shell — data wiring comes later.
 * Renders an empty/ready state that matches Staff Desk styling.
 */
export function TodaysAppointmentsPanel() {
  const todayLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const [filter, setFilter] = useState<AppointmentFilter>("all");
  const [query, setQuery] = useState("");

  const tabs: Array<{ id: AppointmentFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: 0 },
    { id: "scheduled", label: "Scheduled", count: 0 },
    { id: "in_progress", label: "In Progress", count: 0 },
    { id: "completed", label: "Completed", count: 0 },
  ];

  return (
    <aside className="st-card flex h-auto min-h-[22rem] w-full flex-col overflow-hidden rounded-[1.15rem] px-4 py-4 shadow-[0_10px_28px_rgb(20_40_28/0.08)] xl:h-full xl:min-h-[28rem] xl:min-w-[20rem]">
      <div className="mb-3 flex flex-shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[hsl(var(--st-green))]" />
            <h2 className="text-base font-semibold text-[hsl(var(--st-text))]">Today's Appointments</h2>
          </div>
          <p className="mt-1 text-xs st-muted">{todayLabel}</p>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-[hsl(var(--st-muted))] hover:bg-[hsl(var(--st-cream))]"
          aria-label="Appointment options"
          disabled
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="st-scroll-x mb-3 flex flex-shrink-0 gap-0.5 overflow-x-auto border-b border-[hsl(var(--st-border))] pb-px [-ms-overflow-style:none]">
        {tabs.map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`shrink-0 whitespace-nowrap px-2 py-2 text-[11px] font-semibold transition-colors ${
                active
                  ? "border-b-2 border-[hsl(var(--st-maroon))] text-[hsl(var(--st-maroon))]"
                  : "border-b-2 border-transparent text-[hsl(var(--st-muted))] hover:text-[hsl(var(--st-text))]"
              }`}
            >
              {tab.label} {tab.count}
            </button>
          );
        })}
      </div>

      <div className="relative mb-3 flex-shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--st-muted))]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search patient name, HIS ID, or modality..."
          className="h-10 w-full rounded-xl border border-[hsl(var(--st-border))] bg-[hsl(var(--st-cream))] pl-9 pr-3 text-xs text-[hsl(var(--st-text))] outline-none placeholder:text-[hsl(var(--st-muted))] focus-visible:border-[hsl(var(--st-green))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--st-green))]/20"
          aria-label="Search appointments"
        />
      </div>

      <div className="st-scroll flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--st-green-soft))]">
          <CalendarDays className="h-8 w-8 text-[hsl(var(--st-green))]" />
        </div>
        <p className="text-sm font-semibold text-[hsl(var(--st-text))]">Appointments coming soon</p>
        <p className="max-w-[14rem] text-xs st-muted">
          ShanScheduler integration will populate today's schedule here. Filters and search are ready.
        </p>
        {query.trim() || filter !== "all" ? (
          <p className="text-[11px] st-muted">No matching appointments yet.</p>
        ) : null}
      </div>

      <div className="mt-3 flex-shrink-0 border-t border-[hsl(var(--st-border))] pt-3">
        <button
          type="button"
          disabled
          className="w-full text-left text-xs font-semibold text-[hsl(var(--st-green))] opacity-60"
        >
          View All Appointments →
        </button>
      </div>
    </aside>
  );
}
