import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useLocation } from "wouter";

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
  setAuth: (user: any, token: string, refreshToken: string) => void;
  setPortalAuth: (patient: any, token: string) => void;
  logout: () => void;
  portalLogout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<AuthState>(() => {
    try {
      const user = JSON.parse(localStorage.getItem("ace_user") || "null");
      const token = localStorage.getItem("ace_access_token");
      return { user, token };
    } catch {
      return { user: null, token: null };
    }
  });

  const [portalAuth, setPortalAuthState] = useState<PortalState>(() => {
    try {
      const patient = JSON.parse(localStorage.getItem("ace_portal_patient") || "null");
      const token = localStorage.getItem("ace_portal_token");
      return { patient, token };
    } catch {
      return { patient: null, token: null };
    }
  });

  const setAuth = (user: any, token: string, refreshToken: string) => {
    localStorage.setItem("ace_user", JSON.stringify(user));
    localStorage.setItem("ace_access_token", token);
    localStorage.setItem("ace_refresh_token", refreshToken);
    setAuthState({ user, token });
  };

  const logout = () => {
    localStorage.removeItem("ace_user");
    localStorage.removeItem("ace_access_token");
    localStorage.removeItem("ace_refresh_token");
    setAuthState({ user: null, token: null });
  };

  const setPortalAuth = (patient: any, token: string) => {
    localStorage.setItem("ace_portal_patient", JSON.stringify(patient));
    localStorage.setItem("ace_portal_token", token);
    setPortalAuthState({ patient, token });
  };

  const portalLogout = () => {
    localStorage.removeItem("ace_portal_patient");
    localStorage.removeItem("ace_portal_token");
    setPortalAuthState({ patient: null, token: null });
  };

  return (
    <AuthContext.Provider value={{ auth, portalAuth, setAuth, setPortalAuth, logout, portalLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
