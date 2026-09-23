import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api";
import { clearCache, isNetworkError, readCache, writeCache } from "../offline/cache";
import type { AuthUser } from "../types";

type AuthState =
  | { status: "loading" }
  | { status: "needs-setup" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: AuthUser };

const USER_CACHE = "auth.user";

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
    try {
      const status = await api.getAuthStatus();
      if (status.needsSetup) {
        setState({ status: "needs-setup" });
      } else if (status.authenticated && status.user) {
        // Remembered so a reload with no connection doesn't look like being signed out.
        writeCache(USER_CACHE, status.user);
        setState({ status: "authenticated", user: status.user });
      } else {
        localStorage.removeItem("mm.cache." + USER_CACHE);
        setState({ status: "anonymous" });
      }
    } catch (err) {
      const cached = isNetworkError(err) ? readCache<AuthUser>(USER_CACHE) : null;
      if (cached) {
        // Offline: carry on as whoever was last signed in. The session cookie is still
        // in the browser, so the first request after reconnecting settles it properly.
        setState({ status: "authenticated", user: cached.value });
      } else {
        setState({ status: "anonymous" });
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    writeCache(USER_CACHE, result.user!);
    setState({ status: "authenticated", user: result.user! });
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const result = await api.setupAccount(username, password);
    writeCache(USER_CACHE, result.user!);
    setState({ status: "authenticated", user: result.user! });
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    // Signing out clears the offline copies too — someone else may use this device.
    clearCache();
    setState({ status: "anonymous" });
  }, []);

  return <AuthContext.Provider value={{ state, refresh, login, setup, logout }}>{children}</AuthContext.Provider>;
}

/**
 * Whether the signed-in login may do something. Pages ask this rather than
 * comparing role names, so adding a role does not mean hunting for every
 * `role === "admin"` in the client.
 */
export function useCan(): (capability: string) => boolean {
  const { state } = useAuth();
  const caps = state.status === "authenticated" ? state.user.capabilities : undefined;
  return (capability: string) => !!caps?.includes(capability);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Convenience: the signed-in user, or null.
export function useCurrentUser(): AuthUser | null {
  const { state } = useAuth();
  return state.status === "authenticated" ? state.user : null;
}
