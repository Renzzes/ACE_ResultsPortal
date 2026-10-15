const INSTALLED_KEY = "ace_portal_pwa_installed";
const SESSION_DISMISS_KEY = "ace_portal_pwa_prompt_dismissed";
/** Set when the patient chooses Later — enables Install in the profile menu. */
const DEFERRED_KEY = "ace_portal_pwa_deferred";

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Call once at app startup so beforeinstallprompt is not missed. */
export function initPortalPwaCapture(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    markPortalPwaInstalled();
    notify();
  });

  if (isPortalPwaStandalone()) {
    markPortalPwaInstalled();
  }
}

export function subscribePortalPwaPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function clearDeferredInstallPrompt(): void {
  deferredPrompt = null;
  notify();
}

export function isPortalPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return media || iosStandalone;
}

export function isPortalPwaInstalled(): boolean {
  if (isPortalPwaStandalone()) return true;
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPortalPwaInstalled(): void {
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
    localStorage.removeItem(DEFERRED_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function wasPortalPwaPromptDismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function isPortalPwaInstallDeferred(): boolean {
  try {
    return localStorage.getItem(DEFERRED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Call when the patient chooses Later on the install popup. */
export function deferPortalPwaInstall(): void {
  try {
    localStorage.setItem(DEFERRED_KEY, "1");
    sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
  notify();
}

export function shouldOfferPortalPwaInstall(): boolean {
  if (isPortalPwaInstalled()) return false;
  if (wasPortalPwaPromptDismissedThisSession()) return false;
  if (isPortalPwaInstallDeferred()) return false;
  return true;
}

/** Profile menu: show Install anytime until the app is installed. */
export function shouldShowPortalPwaMenuInstall(): boolean {
  return !isPortalPwaInstalled();
}

export type PortalPwaInstallResult =
  | { kind: "accepted" }
  | { kind: "dismissed" }
  | { kind: "manual" }
  | { kind: "error"; message: string };

export async function runPortalPwaInstall(): Promise<PortalPwaInstallResult> {
  const promptEvent = getDeferredInstallPrompt();
  if (!promptEvent) {
    return { kind: "manual" };
  }
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    clearDeferredInstallPrompt();
    if (choice.outcome === "accepted") {
      markPortalPwaInstalled();
      return { kind: "accepted" };
    }
    deferPortalPwaInstall();
    return { kind: "dismissed" };
  } catch {
    return {
      kind: "error",
      message: "Use your browser menu → Add to Home Screen or Install app.",
    };
  }
}
