import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { RESPONSE_HOURS } from "../lib/capacity";
import type { AppSettings } from "../types";

export const FALLBACK_SETTINGS: AppSettings = {
  responseHours: RESPONSE_HOURS,
  warnAtPercent: 80,
  escalation: { enabled: true, afterOverdueHours: 72 },
};

interface SettingsContextValue extends AppSettings {
  loaded: boolean;
  defaults: AppSettings;
  refresh: () => Promise<void>;
  save: (next: AppSettings) => Promise<AppSettings>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Organisation settings, fetched once the person is signed in and shared app-wide. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const authed = state.status === "authenticated";
  const [settings, setSettings] = useState<AppSettings>(FALLBACK_SETTINGS);
  const [defaults, setDefaults] = useState<AppSettings>(FALLBACK_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.getSettings();
      setSettings(r.settings);
      setDefaults(r.defaults);
      setLoaded(true);
    } catch {
      /* keep fallbacks; the server applies its own defaults anyway */
    }
  }, []);

  useEffect(() => {
    if (authed) refresh();
    else setLoaded(false);
  }, [authed, refresh]);

  const save = useCallback(async (next: AppSettings) => {
    const r = await api.saveSettings(next);
    setSettings(r.settings);
    return r.settings;
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({ ...settings, loaded, defaults, refresh, save }), [settings, loaded, defaults, refresh, save]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
