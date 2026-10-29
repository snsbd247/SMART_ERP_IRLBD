import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { dataClient } from "@/integrations/data/client";
import { logLoginAttempt, logLogout } from "@/lib/audit-utils";
import {
  isLaravelMode,
  laravelLogin,
  laravelLogout,
  laravelMe,
  getLaravelToken,
  type LaravelUser,
} from "@/lib/laravel-auth";

export interface User {
  id: string;
  email?: string | null;
}

export interface Session {
  access_token: string;
  user: User;
}

interface Profile {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  branch_id: string | null;
  employee_id: string | null;
  status: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: string[];
  permissions: string[];
  loading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** Accepts "module.action" (new) or (module, action) legacy format */
  hasPermission: (moduleOrPermission: string, action?: string) => boolean;
  /** In Laravel mode the first arg is treated as a username. */
  signIn: (emailOrUsername: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, meta?: Record<string, string>) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LARAVEL = isLaravelMode();

function laravelUserToProfile(u: LaravelUser): Profile {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    phone: u.phone,
    branch_id: u.branch_id,
    employee_id: u.employee_id ?? null,
    status: "active",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // ───────── Laravel mode helpers ─────────
  const applyLaravelUser = useCallback((u: LaravelUser) => {
    setProfile(laravelUserToProfile(u));
    setPermissions(u.is_super_admin ? ["*"] : (u.permissions ?? []));
    // Synthesize a minimal User/Session shape so existing code paths don't break.
    setUser({ id: u.id, email: u.email } as unknown as User);
    setSession({ access_token: getLaravelToken() ?? "", user: { id: u.id } } as unknown as Session);
  }, []);

  // ───────── Profile fetch (unchanged) ─────────
  const fetchProfile = useCallback(async (userId: string) => {
    const { data: profileData } = await dataClient
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileData) {
      const p = profileData as any;
      setProfile({
        id: p.id,
        name: p.name,
        username: p.username,
        email: p.email,
        phone: p.phone,
        branch_id: p.branch_id,
        employee_id: p.employee_id ?? null,
        status: p.status,
      });

      const isSA = p.employee_id === null || p.employee_id === undefined;
      if (isSA) {
        setPermissions(["*"]);
      } else {
        const { data: customRoleLinks } = await dataClient
          .from("user_custom_roles" as any)
          .select("custom_role_id")
          .eq("user_id", userId);

        if (customRoleLinks && customRoleLinks.length > 0) {
          const roleIds = customRoleLinks.map((r: any) => r.custom_role_id);
          const { data: perms } = await dataClient
            .from("role_permissions")
            .select("*")
            .in("custom_role_id", roleIds);

          if (perms) {
            const actionMap: Record<string, string> = {
              can_view: "view", can_add: "create", can_edit: "edit", can_delete: "delete",
            };
            const merged: Record<string, Record<string, boolean>> = {};
            perms.forEach((p: any) => {
              if (!merged[p.module]) merged[p.module] = {};
              Object.entries(actionMap).forEach(([col, action]) => {
                if (p[col]) merged[p.module][action] = true;
              });
            });
            const flatPerms: string[] = [];
            Object.entries(merged).forEach(([mod, actions]) => {
              Object.entries(actions).forEach(([action, granted]) => {
                if (granted) flatPerms.push(`${mod}.${action}`);
              });
            });
            setPermissions(flatPerms);
          } else setPermissions([]);
        } else setPermissions([]);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (LARAVEL) {
      const u = await laravelMe();
      if (u) applyLaravelUser(u);
    } else if (user) {
      await fetchProfile(user.id);
    }
  }, [user, fetchProfile, applyLaravelUser]);

  // ───────── Bootstrap ─────────
  useEffect(() => {
    if (LARAVEL) {
      const token = getLaravelToken();
      if (token) {
        laravelMe().then((u) => {
          if (u) applyLaravelUser(u);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
      return;
    }

    const { data: { subscription } } = dataClient.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => fetchProfile(session.user.id), 0);
      } else {
        setProfile(null);
        setPermissions([]);
      }
      setLoading(false);
    });

    dataClient.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, applyLaravelUser]);

  // ───────── signIn ─────────
  const signIn = async (emailOrUsername: string, password: string) => {
    if (LARAVEL) {
      try {
        const u = await laravelLogin(emailOrUsername, password);
        applyLaravelUser(u);
        return { error: null };
      } catch (e: any) {
        return { error: e as Error };
      }
    }

    const { data, error } = await dataClient.auth.signInWithPassword({ email: emailOrUsername, password });
    try {
      await logLoginAttempt({ userId: data?.user?.id, email: emailOrUsername, success: !error });
      if (!error && data?.user?.id) {
        await dataClient.from("login_logs" as any).insert({
          user_id: data.user.id,
          ip_address: null,
          user_agent: navigator.userAgent,
          login_time: new Date().toISOString(),
        });
        await dataClient.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", data.user.id);
      }
    } catch { /* ignore */ }
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, meta?: Record<string, string>) => {
    if (LARAVEL) {
      return { error: new Error("Signup not supported in Laravel mode. Ask an admin to create your account.") };
    }
    const { error } = await dataClient.auth.signUp({
      email,
      password,
      options: { data: meta, emailRedirectTo: window.location.origin },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    if (LARAVEL) {
      await laravelLogout();
      setUser(null);
      setSession(null);
      setProfile(null);
      setPermissions([]);
      return;
    }

    try {
      await logLogout(user?.id);
      if (user?.id) {
        const { data: latestLog } = await dataClient
          .from("login_logs" as any)
          .select("id")
          .eq("user_id", user.id)
          .is("logout_time", null)
          .order("login_time", { ascending: false })
          .limit(1)
          .single();
        if (latestLog) {
          await dataClient.from("login_logs" as any).update({ logout_time: new Date().toISOString() }).eq("id", (latestLog as any).id);
        }
      }
    } catch { /* ignore */ }
    await dataClient.auth.signOut();
  };

  const isSuperAdmin = profile?.employee_id === null || profile?.employee_id === undefined || permissions.includes("*");
  const isAdmin = isSuperAdmin;
  const roles: string[] = isSuperAdmin ? ["super_admin"] : [];

  const hasPermission = useCallback(
    (moduleOrPermission: string, action?: string): boolean => {
      if (isSuperAdmin) return true;
      if (permissions.includes("*")) return true;
      if (action) {
        const actionMap: Record<string, string> = {
          can_view: "view", can_add: "create", can_edit: "edit", can_delete: "delete",
        };
        const mapped = actionMap[action] || action;
        return permissions.includes(`${moduleOrPermission}.${mapped}`);
      }
      return permissions.includes(moduleOrPermission);
    },
    [isSuperAdmin, permissions]
  );

  return (
    <AuthContext.Provider value={{
      user, session, profile, roles, permissions, loading,
      isAdmin, isSuperAdmin, hasPermission,
      signIn, signUp, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
