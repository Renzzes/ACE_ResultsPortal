import { useEffect, useState } from "react";
import { MonitorDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  deferPortalPwaInstall,
  runPortalPwaInstall,
  shouldOfferPortalPwaInstall,
  subscribePortalPwaPrompt,
} from "@/lib/portal-pwa";

/**
 * After patient login, offer PWA install once. "Later" closes the popup and adds
 * Install app to the profile menu until the app is installed.
 */
export function PortalPwaInstallDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!shouldOfferPortalPwaInstall()) {
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return subscribePortalPwaPrompt(() => {
      if (!shouldOfferPortalPwaInstall()) setOpen(false);
    });
  }, []);

  if (!open) return null;

  function chooseLater() {
    deferPortalPwaInstall();
    setOpen(false);
  }

  async function install() {
    setBusy(true);
    try {
      const result = await runPortalPwaInstall();
      if (result.kind === "accepted") {
        setOpen(false);
        toast({
          title: "App installed",
          description: "You can open ACE Results Portal from your home screen.",
        });
        return;
      }
      if (result.kind === "manual") {
        toast({
          title: "Install ACE Results Portal",
          description: "Open your browser menu and choose Add to Home Screen or Install app.",
        });
        return;
      }
      if (result.kind === "error") {
        toast({
          title: "Could not open install prompt",
          description: result.message,
          variant: "destructive",
        });
        return;
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="portal-pwa-install-title"
        className="relative w-full max-w-md rounded-2xl border border-[#DDE5E0] bg-white p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={chooseLater}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Install later"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8F4EC] text-[#2F7D4A]">
          <MonitorDown className="h-6 w-6" />
        </div>

        <h2 id="portal-pwa-install-title" className="mt-4 pr-8 text-xl font-bold text-[#17221D]">
          Install ACE Results Portal
        </h2>
        <p className="mt-2 text-sm text-[#64706A]">
          Add this app to your home screen for quicker access to your results — no App Store needed.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="h-11 flex-1 rounded-md border-0 bg-[#97ab96] text-base font-semibold text-white hover:bg-[#879c86]"
            disabled={busy}
            onClick={() => void install()}
          >
            {busy ? "Opening…" : "Install"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 rounded-md border-[#DDE5E0]"
            disabled={busy}
            onClick={chooseLater}
          >
            Later
          </Button>
        </div>
      </div>
    </div>
  );
}
