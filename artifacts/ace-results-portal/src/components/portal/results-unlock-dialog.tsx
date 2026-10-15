import { useState, type FormEvent } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fieldClass =
  "h-12 rounded-md border-gray-200 bg-white text-[15px] placeholder:text-gray-400 focus-visible:ring-[#97ab96]";

export function PortalResultsUnlockDialog({
  open,
  busy,
  error,
  requestBusy,
  requestMessage,
  onSubmit,
  onClose,
  onRequestAccessCode,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  requestBusy?: boolean;
  requestMessage?: string | null;
  onSubmit: (accessCode: string) => void;
  onClose: () => void;
  onRequestAccessCode: () => void;
}) {
  const [accessCode, setAccessCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  if (!open) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!accessCode.trim()) return;
    onSubmit(accessCode.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-2xl border border-[#DDE5E0] bg-white p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close and return to dashboard"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="pr-10 text-xl font-bold text-[#17221D]">Enter your access code</h2>
        <p className="mt-2 text-sm text-[#64706A]">
          Your access code is required to view and download diagnostic results. It is separate from your sign-in password.
        </p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          <p className="font-semibold">Take note of your access code</p>
          <p className="mt-1 text-amber-900/90">
            Your access code does not expire. Keep it somewhere safe and reuse it whenever you open Results.
            Only use Forgot Access Code if you lost it — staff will issue a new code and your old one will stop working.
          </p>
        </div>

        <div className="mt-5 space-y-1.5">
          <Label htmlFor="resultsAccessCode" className="text-[15px] font-semibold text-gray-900">
            Access Code
          </Label>
          <div className="relative">
            <Input
              id="resultsAccessCode"
              type={showCode ? "text" : "password"}
              placeholder="Enter your access code"
              className={`${fieldClass} pr-11 font-mono tracking-wide`}
              autoComplete="off"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowCode((value) => !value)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-400 hover:text-gray-600"
              aria-label={showCode ? "Hide access code" : "Show access code"}
            >
              {showCode ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        <Button
          type="submit"
          className="mt-6 h-12 w-full rounded-md border-0 bg-[#97ab96] text-base font-semibold text-white hover:bg-[#879c86]"
          disabled={busy || !accessCode.trim()}
        >
          {busy ? "Verifying…" : "Unlock Results"}
        </Button>

        <div className="mt-4 text-center">
          <button
            type="button"
            className="text-sm font-semibold text-[#2f5d38] underline underline-offset-2"
            onClick={() => setForgotOpen((value) => !value)}
          >
            Forgot Access Code?
          </button>
        </div>

        {forgotOpen && (
          <div className="mt-4 rounded-xl border border-[#DDE5E0] bg-[#F6F9F7] p-4">
            <p className="text-sm text-[#64706A]">
              Request another access code from ACE Medical Center Cebu. Hospital staff will be notified and can email you a new code.
            </p>
            {requestMessage && <p className="mt-3 text-sm font-medium text-[#2F7D4A]">{requestMessage}</p>}
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-11 w-full border-[#2F7D4A] text-[#2F7D4A]"
              disabled={requestBusy}
              onClick={onRequestAccessCode}
            >
              {requestBusy ? "Sending request…" : "Request another Code"}
            </Button>
          </div>
        )}

        <Button type="button" variant="ghost" className="mt-3 h-10 w-full text-[#64706A]" onClick={onClose}>
          Close and return to dashboard
        </Button>
      </form>
    </div>
  );
}
