import { Link } from "wouter";
import type { PortalCareHistoryEvent } from "@workspace/api-client-react";
import { formatPortalDate, formatPortalDateTime, formatPortalLongDate } from "@/lib/patient-identity";
import { CalendarDays, Clock, FileText, Pill } from "lucide-react";

function eventKey(event: PortalCareHistoryEvent): string {
  if (event.type === "appointment") return `appointment-${event.appointmentId ?? event.date}`;
  return `${event.type}-${event.entityId ?? event.date}`;
}

function EventIcon({ type }: { type: PortalCareHistoryEvent["type"] }) {
  if (type === "appointment") return <CalendarDays className="h-4 w-4" aria-hidden />;
  if (type === "prescription") return <Pill className="h-4 w-4" aria-hidden />;
  return <FileText className="h-4 w-4" aria-hidden />;
}

function typeLabel(type: PortalCareHistoryEvent["type"]): string {
  if (type === "appointment") return "Appointment";
  if (type === "prescription") return "Prescription";
  return "Result";
}

function eventWhen(event: PortalCareHistoryEvent): string {
  if (event.appointment?.date) {
    const day = formatPortalLongDate(event.appointment.date);
    const time = event.appointment.time?.trim();
    return time ? `${day} · ${time}` : day;
  }
  if (event.type === "result" || event.type === "prescription") {
    return formatPortalDateTime(event.date);
  }
  return formatPortalDate(event.date);
}

export function CareHistoryTimeline({
  events,
  emptyMessage = "No care history yet.",
}: {
  events: PortalCareHistoryEvent[];
  emptyMessage?: string;
}) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-[#64706A]">{emptyMessage}</p>;
  }

  return (
    <ol className="space-y-0" aria-label="Care history timeline">
      {events.map((event, index) => (
        <li key={eventKey(event)} className="relative flex gap-4 pb-8 last:pb-0">
          {index < events.length - 1 ? (
            <span className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-[#DDE5E0]" aria-hidden />
          ) : null}
          <span className="relative z-10 mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#E8F4EC] text-[#2F7D4A]">
            <EventIcon type={event.type} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[#64706A]">{eventWhen(event)}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#2F7D4A]">
              {typeLabel(event.type)}
              <span className="sr-only"> event</span>
            </p>
            <p className="mt-0.5 font-semibold text-[#17221D]">{event.subtitle || event.title}</p>
            {event.summary ? <p className="text-sm text-[#64706A]">{event.summary}</p> : null}
            {event.doctorName ? (
              <p className="mt-1 text-xs text-[#64706A]">Doctor: {event.doctorName}</p>
            ) : null}
            {event.status && event.type === "appointment" ? (
              <p className="mt-1 text-xs font-semibold text-[#64706A]">Status: {event.status}</p>
            ) : null}
            {event.type === "result" ? (
              <p className="mt-1 text-xs font-semibold text-[#2F7D4A]">Released</p>
            ) : null}
            {event.href ? (
              <Link
                href={event.href}
                className="mt-2 inline-block text-xs font-semibold text-[#2F7D4A] no-underline hover:underline"
              >
                {event.type === "prescription" ? "View Prescription" : "View Result"}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CareHistoryLoadingSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading care history">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-8 w-8 animate-pulse rounded-full bg-[#E8F4EC]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-[#E8F4EC]" />
            <div className="h-4 w-56 animate-pulse rounded bg-[#E8F4EC]" />
            <div className="h-3 w-28 animate-pulse rounded bg-[#E8F4EC]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CareHistoryHeader() {
  return (
    <div className="flex items-center gap-2">
      <Clock className="h-5 w-5 text-[#2F7D4A]" aria-hidden />
      <div>
        <h2 className="text-lg font-semibold text-[#17221D]">Care History</h2>
        <p className="text-sm text-[#64706A]">
          Appointments, released results, and prescriptions — newest first.
        </p>
      </div>
    </div>
  );
}
