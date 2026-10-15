export type ReportsRangePreset = "today" | "7d" | "30d" | "90d" | "year" | "custom";

export const REPORT_RANGE_OPTIONS: { id: ReportsRangePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 Days" },
  { id: "30d", label: "Last 30 Days" },
  { id: "90d", label: "Last 90 Days" },
  { id: "year", label: "This Year" },
  { id: "custom", label: "Custom Range" },
];

export type ReportsDateRange = {
  preset: ReportsRangePreset;
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  label: string;
  vsLabel: string;
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatRangeLabel(from: Date, to: Date) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  return `${from.toLocaleDateString("en-PH", opts)} – ${to.toLocaleDateString("en-PH", opts)}`;
}

export function buildReportsRange(
  preset: ReportsRangePreset,
  customFrom?: string,
  customTo?: string,
): ReportsDateRange {
  const now = new Date();
  let from = startOfDay(now);
  let to = endOfDay(now);

  if (preset === "today") {
    from = startOfDay(now);
  } else if (preset === "7d") {
    from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  } else if (preset === "30d") {
    from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
  } else if (preset === "90d") {
    from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89));
  } else if (preset === "year") {
    from = startOfDay(new Date(now.getFullYear(), 0, 1));
  } else {
    from = customFrom ? startOfDay(new Date(`${customFrom}T00:00:00`)) : startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    to = customTo ? endOfDay(new Date(`${customTo}T00:00:00`)) : endOfDay(now);
    if (from > to) {
      const swap = from;
      from = startOfDay(to);
      to = endOfDay(swap);
    }
  }

  const duration = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - duration);

  const vsLabel =
    preset === "today"
      ? "vs previous day"
      : preset === "year"
        ? "vs previous year"
        : `vs previous ${REPORT_RANGE_OPTIONS.find((item) => item.id === preset)?.label.replace("Last ", "").replace("This ", "").toLowerCase() ?? "period"}`;

  return {
    preset,
    from,
    to,
    previousFrom: startOfDay(previousFrom),
    previousTo: endOfDay(previousTo),
    label: formatRangeLabel(from, to),
    vsLabel,
  };
}

export function toQueryDate(value: Date) {
  return value.toISOString();
}

export function formatManilaDateTime(value = new Date()) {
  return value.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function formatDept(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
