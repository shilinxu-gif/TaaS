import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type MeUser } from "./api";

type AuthState = {
  user: MeUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: MeUser) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("crm_token")
  );
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(!!localStorage.getItem("crm_token"));

  const refreshMe = useCallback(async () => {
    const t = localStorage.getItem("crm_token");
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<MeUser>("/me");
      setUser(me);
    } catch {
      setUser(null);
      localStorage.removeItem("crm_token");
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onUnauth = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener("crm:unauthorized", onUnauth);
    return () => window.removeEventListener("crm:unauthorized", onUnauth);
  }, []);

  const login = useCallback((newToken: string, u: MeUser) => {
    localStorage.setItem("crm_token", newToken);
    setToken(newToken);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("crm_token");
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      login,
      logout,
      refreshMe,
    }),
    [user, token, loading, login, logout, refreshMe]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
