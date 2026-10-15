import { useEffect, useState } from "react";
import { Copy, Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PatientAvatar } from "@/components/doctor/shared";
import { useToast } from "@/hooks/use-toast";

type CallStatus = "connecting" | "connected" | "ended";

function formatElapsed(total: number) {
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function ClinicCallDialog({
  open,
  onOpenChange,
  firstName,
  lastName,
  patientHisId,
  reason,
  mobileNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firstName: string;
  lastName: string;
  patientHisId?: string;
  reason?: string;
  mobileNumber?: string | null;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const fullName = `${firstName} ${lastName}`.trim();

  useEffect(() => {
    if (!open) return;
    setStatus("connecting");
    setSeconds(0);
    setMuted(false);
    const connect = window.setTimeout(() => setStatus("connected"), 1400);
    return () => window.clearTimeout(connect);
  }, [open, firstName, lastName]);

  useEffect(() => {
    if (!open || status !== "connected") return;
    const tick = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, [open, status]);

  function endCall() {
    setStatus("ended");
    window.setTimeout(() => onOpenChange(false), 650);
  }

  async function copyNumber() {
    if (!mobileNumber) return;
    try {
      await navigator.clipboard.writeText(mobileNumber.replace(/\s+/g, ""));
      toast({ title: "Number copied", description: mobileNumber });
    } catch {
      toast({ title: "Could not copy number", variant: "destructive" });
    }
  }

  const statusLabel =
    status === "connecting" ? "Connecting…" : status === "connected" ? "Clinic line · In call" : "Call ended";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : endCall())}>
      <DialogContent
        className="doctor-shell max-w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border-[hsl(var(--doc-border))] bg-[hsl(var(--doc-card))] p-0 shadow-2xl z-[80] [&>button]:hidden"
      >
        <div className="relative overflow-hidden px-6 pb-6 pt-8 text-center">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[linear-gradient(180deg,hsl(var(--doc-green-soft)),transparent)]" />
          <DialogTitle className="sr-only">Call {fullName}</DialogTitle>
          <DialogDescription className="sr-only">
            In-portal clinic call. This does not open the computer phone app.
          </DialogDescription>

          <div className="relative mx-auto mb-4 w-24 h-24">
            {(status === "connecting" || status === "connected") && (
              <>
                <span className="absolute inset-0 rounded-full bg-[hsl(var(--doc-green))]/20 animate-ping" />
                <span className="absolute inset-2 rounded-full bg-[hsl(var(--doc-green))]/15" />
              </>
            )}
            <div className="relative flex h-full items-center justify-center">
              <PatientAvatar firstName={firstName} lastName={lastName} size="xl" />
            </div>
          </div>

          <p className="relative text-lg font-semibold text-[hsl(var(--doc-text))]">{fullName}</p>
          <p className="relative mt-0.5 text-sm text-[hsl(var(--doc-green))] font-medium">
            {reason ?? "Consultation"}
          </p>
          {patientHisId ? (
            <p className="relative mt-1 text-[11px] font-mono doc-muted">{patientHisId}</p>
          ) : null}
          <p className="relative mt-3 text-sm font-medium tabular-nums text-[hsl(var(--doc-text))]">
            {status === "connected" ? formatElapsed(seconds) : statusLabel}
          </p>
          <p className="relative mt-1 text-xs doc-muted">
            {status === "connected" ? (mobileNumber ?? "Secure clinic line") : "ACE clinic line · in portal"}
          </p>
        </div>

        <div className="flex items-center justify-center gap-4 px-6 pb-7">
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            disabled={status !== "connected"}
            className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
              muted
                ? "bg-[hsl(var(--doc-maroon))] text-white"
                : "bg-[hsl(var(--doc-elevated))] text-[hsl(var(--doc-text))] hover:bg-[hsl(var(--doc-green-soft))]"
            } disabled:opacity-40`}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={endCall}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--doc-maroon))] text-white shadow-lg hover:brightness-95"
            aria-label="End call"
          >
            {status === "ended" ? <Phone className="h-6 w-6" /> : <PhoneOff className="h-6 w-6" />}
          </button>
          <button
            type="button"
            disabled
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--doc-elevated))] text-[hsl(var(--doc-text))] opacity-60"
            aria-label="Speaker"
          >
            <Volume2 className="h-5 w-5" />
          </button>
        </div>

        {mobileNumber ? (
          <div className="border-t border-[hsl(var(--doc-border))] px-6 py-3">
            <button
              type="button"
              onClick={() => void copyNumber()}
              className="flex w-full items-center justify-center gap-2 text-xs font-medium doc-muted hover:text-[hsl(var(--doc-green))]"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy clinic number
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
