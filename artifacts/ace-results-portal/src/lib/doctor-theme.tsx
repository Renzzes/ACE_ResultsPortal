import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type DoctorThemeMode = "light" | "dark";

const STORAGE_KEY = "ace_doctor_theme";

interface DoctorThemeContextValue {
  mode: DoctorThemeMode;
  toggle: () => void;
  setMode: (mode: DoctorThemeMode) => void;
}

const DoctorThemeContext = createContext<DoctorThemeContextValue | null>(null);

function readStoredMode(): DoctorThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function DoctorThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DoctorThemeMode>(readStoredMode);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const setMode = (next: DoctorThemeMode) => setModeState(next);
  const toggle = () => setModeState((current) => (current === "light" ? "dark" : "light"));

  return (
    <DoctorThemeContext.Provider value={{ mode, toggle, setMode }}>
      {children}
    </DoctorThemeContext.Provider>
  );
}

export function useDoctorTheme() {
  const ctx = useContext(DoctorThemeContext);
  if (!ctx) {
    throw new Error("useDoctorTheme must be used within DoctorThemeProvider");
  }
  return ctx;
}
