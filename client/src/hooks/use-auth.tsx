import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  plan: string;
  generationsUsed: number;
  generationsLimit: number | null; // null = unlimited
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ME_KEY = ["/api/auth/me"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery<AuthUser | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to load session");
      return res.json();
    },
  });

  const loginMut = useMutation({
    mutationFn: async (vars: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", vars);
      return res.json();
    },
    onSuccess: (u) => queryClient.setQueryData(ME_KEY, u),
  });

  const registerMut = useMutation({
    mutationFn: async (vars: { username: string; password: string; email?: string }) => {
      const res = await apiRequest("POST", "/api/auth/register", vars);
      return res.json();
    },
    onSuccess: (u) => queryClient.setQueryData(ME_KEY, u),
  });

  const value: AuthContextValue = {
    user: data ?? null,
    isLoading,
    login: async (username, password) => {
      await loginMut.mutateAsync({ username, password });
    },
    register: async (username, password, email) => {
      await registerMut.mutateAsync({ username, password, email });
    },
    logout: async () => {
      await apiRequest("POST", "/api/auth/logout");
      queryClient.setQueryData(ME_KEY, null);
    },
    refresh: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
