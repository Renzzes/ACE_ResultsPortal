import { Link } from "wouter";
import { useEffect, useState } from "react";
import { Calendar, Clock } from "lucide-react";

function toIsoDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function SeeAllLink({ href, label = "See all" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-[hsl(var(--doc-green))] hover:underline no-underline">
      {label}
    </Link>
  );
}

export function DateFilterChip({
  value,
  onChange,
  showWeekday = false,
}: {
  value: Date;
  onChange: (next: Date) => void;
  showWeekday?: boolean;
}) {
  const iso = toIsoDate(value);
  const dateLabel = value.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const weekday = value.toLocaleDateString("en-US", { weekday: "long" });
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-[hsl(var(--doc-border))] bg-white px-3 py-2 text-sm font-medium text-[hsl(var(--doc-text))] shadow-sm hover:border-[hsl(var(--doc-green))] sm:px-4">
      <Calendar className="h-4 w-4 text-[hsl(var(--doc-green))]" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate">{dateLabel}</span>
        {showWeekday ? <span className="text-xs font-normal doc-muted">{weekday}</span> : null}
      </span>
      <input
        type="date"
        className="sr-only"
        value={iso}
        onChange={(e) => {
          if (!e.target.value) return;
          onChange(new Date(`${e.target.value}T00:00:00`));
        }}
      />
    </label>
  );
}

export function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  return (
    <div className="inline-flex items-center gap-2 rounded-2xl bg-[hsl(var(--doc-green))] px-3 py-2 text-sm font-semibold tabular-nums text-white shadow-sm sm:px-4">
      <Clock className="h-4 w-4" />
      <span aria-live="polite" aria-label="Current time">{time}</span>
    </div>
  );
}
