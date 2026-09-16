import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DashboardData } from "../types";

export interface DashboardState {
  data: DashboardData | null;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

export const DashboardContext = createContext<DashboardState>({ data: null, error: null, lastUpdated: null, refresh: () => {} });

export function useDashboard(): DashboardState {
  return useContext(DashboardContext);
}

export function useDashboardPolling(intervalMs = 15000): DashboardState {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api.getDashboard();
      setData(next);
      setError(null);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message ?? "Could not load dashboard data");
    } finally {
      inFlight.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return { data, error, lastUpdated, refresh };
}

export function useClock(tickMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}
