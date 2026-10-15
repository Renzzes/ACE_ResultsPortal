import type { ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

export function AnalyticsKpiCard({
  label,
  value,
  loading,
  unavailable,
  delta,
  vsLabel,
  warn,
  spark,
}: {
  label: string;
  value?: number | null;
  loading?: boolean;
  unavailable?: boolean;
  delta?: number | null;
  vsLabel?: string;
  warn?: boolean;
  spark?: number[];
}) {
  const showDash = unavailable || (!loading && (value === null || value === undefined));
  const deltaUp = (delta ?? 0) > 0;
  const deltaDown = (delta ?? 0) < 0;
  const deltaClass = warn
    ? deltaDown
      ? "text-[#1F6B45]"
      : "text-[#8B3A46]"
    : deltaUp
      ? "text-[#1F6B45]"
      : deltaDown
        ? "text-[#8B3A46]"
        : "text-[#66756C]";

  return (
    <section className={`ad-card rounded-xl p-3 ${warn ? "border-[#E8D5D8]" : ""}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#66756C]">{label}</p>
      {loading ? (
        <div className="mt-2 h-8 w-20 animate-pulse rounded bg-[#EAF5EE]" />
      ) : (
        <p className={`mt-1.5 text-2xl font-bold tabular-nums ${warn ? "text-[#8B3A46]" : "text-[#0F3D2E]"}`}>
          {showDash ? "—" : Number(value).toLocaleString("en-PH")}
        </p>
      )}
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="min-w-0">
          {loading ? (
            <div className="h-3 w-24 animate-pulse rounded bg-[#EAF5EE]" />
          ) : showDash ? (
            <p className="text-[11px] text-[#66756C]">Data unavailable</p>
          ) : delta === null || delta === undefined ? (
            <p className="text-[11px] text-[#66756C]">Comparison unavailable</p>
          ) : (
            <p className={`text-[11px] font-semibold ${deltaClass}`}>
              {deltaUp ? "+" : ""}
              {delta}% {vsLabel}
            </p>
          )}
        </div>
        {spark && spark.length > 1 && !loading && !showDash ? (
          <div className="h-8 w-16 shrink-0" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark.map((point, index) => ({ i: index, v: point }))}>
                <Line type="monotone" dataKey="v" stroke={warn ? "#8B3A46" : "#2F8F57"} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function WidgetFrame({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ad-card flex min-h-0 flex-col rounded-xl p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[#0F3D2E]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function WidgetSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-8 animate-pulse rounded-lg bg-[#EAF5EE]" />
      ))}
    </div>
  );
}

export function WidgetEmpty({
  title = "No analytics data available",
  body = "There is not enough activity for the selected period.",
  action,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[8rem] flex-col items-center justify-center px-4 py-6 text-center">
      <p className="text-sm font-semibold text-[#0F3D2E]">{title}</p>
      <p className="mt-1 text-[12px] text-[#66756C]">{body}</p>
      {action}
    </div>
  );
}

export function WidgetError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex min-h-[8rem] flex-col items-center justify-center px-4 py-6 text-center">
      <p className="text-sm font-semibold text-[#0F3D2E]">Unable to load analytics</p>
      <p className="mt-1 text-[12px] text-[#66756C]">We could not retrieve this information right now.</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-[#0F3D2E] px-3 py-1.5 text-[12px] font-semibold text-white">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export const REPORT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "patients", label: "Patients" },
  { id: "results", label: "Results" },
  { id: "users", label: "Users" },
  { id: "departments", label: "Departments" },
  { id: "system", label: "System" },
  { id: "security", label: "Security" },
  { id: "custom", label: "Custom Reports" },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]["id"];
