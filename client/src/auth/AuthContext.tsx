import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api";

type AuthState =
  | { status: "loading" }
  | { status: "needs-setup" }
  | { status: "anonymous" }
  | { status: "authenticated"; username: string };

interface AuthContextValue {
  state: AuthState;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    const status = await api.getAuthStatus();
    if (status.needsSetup) {
      setState({ status: "needs-setup" });
    } else if (status.authenticated && status.username) {
      setState({ status: "authenticated", username: status.username });
    } else {
      setState({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setState({ status: "anonymous" }));
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    setState({ status: "authenticated", username: result.username! });
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const result = await api.setupAccount(username, password);
    setState({ status: "authenticated", username: result.username! });
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setState({ status: "anonymous" });
  }, []);

  return <AuthContext.Provider value={{ state, refresh, login, setup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
