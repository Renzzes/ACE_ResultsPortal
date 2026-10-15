import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { ApiError, getCurrentUser } from "@workspace/api-client-react";
import {
  ACCESS_TOKEN_KEY,
  PORTAL_TOKEN_KEY,
  SESSION_PUBLIC_ID_KEY,
  USER_PROFILE_KEY,
  PORTAL_PROFILE_KEY,
  authoritativeRole,
  clearTabAuth,
  forgetSharedAuthStorage,
  persistEmployeeTabSession,
  persistPatientTabSession,
  readSessionPublicId,
  roleFromAccessTokenPayload,
  sessionLogoutPath,
  shouldApplyAuthBootstrap,
  shouldClearSessionAfterMeFailure,
  userWithAuthoritativeRole,
  type RefreshOutcome,
} from "@/lib/workflow-stability";
import { clearStoredPortalResultsAccessCode } from "@/lib/portal-results-access";

interface AuthState {
  user: any | null;
  token: string | null;
}

interface PortalState {
  patient: any | null;
  token: string | null;
}

interface AuthContextType {
  auth: AuthState;
  portalAuth: PortalState;
  sessionReady: boolean;
  setAuth: (user: any, token: string, sessionPublicId: string) => void;
  setPortalAuth: (patient: any, token: string, sessionPublicId: string) => void;
  logout: () => void;
  portalLogout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

let staffRefreshOutcome: RefreshOutcome = "none";
let authEpoch = 0;

export function noteStaffRefreshOutcome(outcome: RefreshOutcome) {
  staffRefreshOutcome = outcome;
}

export function currentStaffRefreshOutcome(): RefreshOutcome {
  return staffRefreshOutcome;
}

export function normalizeUser(user: any, token?: string | null) {
  return userWithAuthoritativeRole(user, token);
}

function tabStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function useAuthoritativeRole(): string {
  const { auth } = useAuth();
  let token = auth.token;
  try {
    token = window.sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? auth.token;
  } catch {
    token = auth.token;
  }
  return authoritativeRole(auth.user?.role, token);
}

/** Revokes only this tab's server session. Does not read or send a refresh secret. */
export async function revokeCurrentTabSession(): Promise<void> {
  const store = tabStore();
  if (!store) return;
  const sessionPublicId = readSessionPublicId(store);
  if (!sessionPublicId) return;
  const token = store.getItem(ACCESS_TOKEN_KEY) || store.getItem(PORTAL_TOKEN_KEY);
  await fetch(sessionLogoutPath(sessionPublicId), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).catch(() => undefined);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<AuthState>(() => {
    try {
      const token = window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
      const user = normalizeUser(JSON.parse(window.sessionStorage.getItem(USER_PROFILE_KEY) || "null"), token);
      return { user, token };
    } catch {
      return { user: null, token: null };
    }
  });

  const [portalAuth, setPortalAuthState] = useState<PortalState>(() => {
    try {
      const patient = JSON.parse(window.sessionStorage.getItem(PORTAL_PROFILE_KEY) || "null");
      const token = window.sessionStorage.getItem(PORTAL_TOKEN_KEY);
      return { patient, token };
    } catch {
      return { patient: null, token: null };
    }
  });

  const [sessionReady, setSessionReady] = useState(!auth.token);

  const setAuth = (user: any, token: string, sessionPublicId: string) => {
    authEpoch += 1;
    const normalized = normalizeUser(user, token);
    const store = tabStore();
    if (store) {
      persistEmployeeTabSession(store, { user: normalized, accessToken: token, sessionPublicId });
      try {
        forgetSharedAuthStorage(window.localStorage);
      } catch {
        /* shared storage may be blocked; the tab session is already stored */
      }
    }
    setAuthState({ user: normalized, token });
    setPortalAuthState({ patient: null, token: null });
    setSessionReady(true);
  };

  const logout = () => {
    authEpoch += 1;
    const store = tabStore();
    if (store) clearTabAuth(store);
    setAuthState({ user: null, token: null });
    setPortalAuthState({ patient: null, token: null });
    setSessionReady(true);
  };

  const setPortalAuth = (patient: any, token: string, sessionPublicId: string) => {
    authEpoch += 1;
    const store = tabStore();
    if (store) {
      persistPatientTabSession(store, { patient, accessToken: token, sessionPublicId });
      try {
        forgetSharedAuthStorage(window.localStorage);
      } catch {
        /* shared storage may be blocked; the tab session is already stored */
      }
    }
    setPortalAuthState({ patient, token });
    setAuthState({ user: null, token: null });
  };

  const portalLogout = () => {
    authEpoch += 1;
    const store = tabStore();
    if (store) clearTabAuth(store);
    clearStoredPortalResultsAccessCode();
    setPortalAuthState({ patient: null, token: null });
    setAuthState({ user: null, token: null });
  };

  useEffect(() => {
    const syncFromStorage = () => {
      const store = tabStore();
      const tokenNow = store?.getItem(ACCESS_TOKEN_KEY) ?? null;
      if (!tokenNow) return;
      let raw: unknown = null;
      try {
        raw = JSON.parse(store?.getItem(USER_PROFILE_KEY) || "null");
      } catch {
        raw = null;
      }
      const normalized = normalizeUser(raw, tokenNow);
      if (normalized && store) store.setItem(USER_PROFILE_KEY, JSON.stringify(normalized));
      setAuthState({ user: normalized, token: tokenNow });
      setSessionReady(true);
    };
    window.addEventListener("ace-staff-auth", syncFromStorage);

    const epochAtStart = authEpoch;
    const storeAtStart = tabStore();
    const tokenAtStart = storeAtStart?.getItem(ACCESS_TOKEN_KEY) ?? null;
    const sessionAtStart = storeAtStart ? readSessionPublicId(storeAtStart) : null;
    if (!tokenAtStart) {
      setSessionReady(true);
      return () => window.removeEventListener("ace-staff-auth", syncFromStorage);
    }
    let cancelled = false;
    noteStaffRefreshOutcome("none");
    const apply = () => {
      const store = tabStore();
      return shouldApplyAuthBootstrap({
        cancelled,
        epochAtStart,
        epochNow: authEpoch,
        tokenAtStart,
        tokenNow: store?.getItem(ACCESS_TOKEN_KEY) ?? null,
        sessionAtStart,
        sessionNow: store ? readSessionPublicId(store) : null,
      });
    };
    getCurrentUser()
      .then((user) => {
        if (!apply()) {
          if (!cancelled) {
            const tokenNow = tabStore()?.getItem(ACCESS_TOKEN_KEY) ?? null;
            if (tokenNow && tokenNow !== tokenAtStart) syncFromStorage();
            setSessionReady(true);
          }
          return;
        }
        const store = tabStore();
        const tokenNow = store?.getItem(ACCESS_TOKEN_KEY) ?? null;
        const normalized = normalizeUser(user, tokenNow);
        if (store && normalized) store.setItem(USER_PROFILE_KEY, JSON.stringify(normalized));
        setAuthState({ user: normalized, token: tokenNow });
        setSessionReady(true);
      })
      .catch((err: unknown) => {
        if (!apply()) {
          if (!cancelled) setSessionReady(true);
          return;
        }
        const status = err instanceof ApiError ? err.status : undefined;
        const tokenNow = tabStore()?.getItem(ACCESS_TOKEN_KEY) ?? null;
        const clear = shouldClearSessionAfterMeFailure({
          status,
          accessTokenStillPresent: Boolean(tokenNow),
          refreshOutcome: currentStaffRefreshOutcome(),
          tokenRole: roleFromAccessTokenPayload(tokenNow),
        });
        if (clear) logout();
        else setSessionReady(true);
      });
    return () => {
      cancelled = true;
      window.removeEventListener("ace-staff-auth", syncFromStorage);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ auth, portalAuth, sessionReady, setAuth, setPortalAuth, logout, portalLogout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
