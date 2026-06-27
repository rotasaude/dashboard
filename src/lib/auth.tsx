// AuthContext do dashboard. Sessão server-side (cookie HttpOnly). Sem MFA
// (usuário municipal) e sem switching de cidade (single-tenant). O tenant
// vem da primeira membership do usuário.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode
} from "react";
import {
  fetchCurrentSession, login as apiLogin, logout as apiLogout,
  type SessionUser
} from "./api";

type AuthState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authenticated"; user: SessionUser };

interface AuthValue {
  state: AuthState;
  user: SessionUser | null;
  municipalityId: string | null;
  login: (email_address: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function pickMunicipality(user: SessionUser): string | null {
  return user.memberships[0]?.municipality_id ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ state, setState ] = useState<AuthState>({ kind: "loading" });

  const reload = useCallback(async () => {
    const user = await fetchCurrentSession();
    setState(user ? { kind: "authenticated", user } : { kind: "anonymous" });
  }, []);

  useEffect(() => { void reload(); }, [ reload ]);

  const login = useCallback(async (email_address: string, password: string) => {
    const user = await apiLogin(email_address, password);
    setState({ kind: "authenticated", user });
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setState({ kind: "anonymous" });
  }, []);

  const value = useMemo<AuthValue>(() => {
    const user = state.kind === "authenticated" ? state.user : null;
    return {
      state,
      user,
      municipalityId: user ? pickMunicipality(user) : null,
      login,
      logout,
      reload
    };
  }, [ state, login, logout, reload ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
