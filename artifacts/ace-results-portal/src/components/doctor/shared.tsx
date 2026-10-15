import type { ReactNode } from "react";
import { FileText } from "lucide-react";

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-[hsl(var(--doc-elevated))] ${className ?? ""}`} />;
}

export function initials(firstName?: string, lastName?: string) {
  const last = (lastName?.[0] ?? "").toUpperCase();
  const first = (firstName?.[0] ?? "").toUpperCase();
  return `${last}${first}` || "P";
}

export function ageFromDob(dateOfBirth?: string) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const month = now.getMonth() - dob.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

export function formatDisplayDate(value = new Date()) {
  return value.toLocaleDateString("en-PH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function PatientAvatar({
  firstName,
  lastName,
  size = "md",
}: {
  firstName?: string;
  lastName?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const dims = size === "xl"
    ? "w-[4.5rem] h-[4.5rem] text-xl"
    : size === "lg"
      ? "w-14 h-14 text-base"
      : size === "sm"
        ? "w-8 h-8 text-[10px]"
        : "w-10 h-10 text-sm";
  return (
    <div className={`${dims} rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-[hsl(var(--doc-green))] bg-[hsl(var(--doc-green-soft))]`}>
      {initials(firstName, lastName)}
    </div>
  );
}

export function DashboardCard({
  title,
  action,
  children,
  className,
  compact,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section className={`doc-card rounded-2xl overflow-hidden flex flex-col min-h-0 min-w-0 ${className ?? ""}`}>
      <div className={`flex items-center justify-between ${compact ? "px-4 py-2.5" : "px-5 py-4"}`}>
        <h3 className={`font-semibold text-[hsl(var(--doc-text))] ${compact ? "text-sm" : ""}`}>{title}</h3>
        {action}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

export function EmptyState({
  icon: Icon = FileText,
  title,
  description,
  compact,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-5 ${compact ? "py-8" : "py-12"}`}>
      <div className="w-12 h-12 rounded-full bg-[hsl(var(--doc-green-soft))] flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-[hsl(var(--doc-green))]" />
      </div>
      <p className="font-medium text-[hsl(var(--doc-text))]">{title}</p>
      {description && <p className="text-sm doc-muted mt-1 max-w-xs">{description}</p>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <p className="text-sm font-medium text-[hsl(var(--doc-maroon))]">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 text-sm font-semibold text-[hsl(var(--doc-green))] hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    pending: "bg-[hsl(var(--doc-maroon-soft))] text-[hsl(var(--doc-maroon))]",
    released: "bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]",
    archived: "bg-[hsl(var(--doc-elevated))] doc-muted",
  };
  return (
    <span className={`inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full capitalize ${classes[status] ?? "bg-[hsl(var(--doc-elevated))] doc-muted"}`}>
      {status}
    </span>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  laboratory: "Laboratory", radiology: "Radiology", ultrasound: "Ultrasound",
  ct_scan: "CT Scan", mri: "MRI", ecg: "ECG", echo_2d: "2D Echo",
  rehabilitation: "Rehabilitation", other: "Other",
};

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full bg-[hsl(var(--doc-green-soft))] text-[hsl(var(--doc-green))]">
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

export { CATEGORY_LABELS };
