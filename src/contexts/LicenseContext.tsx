import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

interface LicenseStatus {
  blocked: boolean;
  status: string;
  message: string | null;
  expires_at: string | null;
}

interface LicenseContextType {
  loading: boolean;
  blocked: boolean;
  status: string | null;
  message: string | null;
  expiresAt: string | null;
  refetch: () => Promise<void>;
  activate: (licenseKey: string) => Promise<{ ok: boolean; message: string }>;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

function apiUrl(path: string): string {
  const base = (getApiBaseUrl() || "").replace(/\/$/, "");
  return `${base}/v1/${path.replace(/^\//, "")}`;
}

export function LicenseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LicenseStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!user || !getApiBaseUrl()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("license/status"), {
        headers: { Accept: "application/json", ...getLaravelAuthHeaders() },
      });
      const json = await res.json();
      if (res.ok && json?.data) {
        setData(json.data as LicenseStatus);
      } else {
        // Fail closed on an unreadable response — don't silently allow access.
        setData({ blocked: true, status: "error", message: json?.message || "Could not check license status.", expires_at: null });
      }
    } catch {
      setData({ blocked: true, status: "error", message: "Could not reach the server to check license status.", expires_at: null });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const activate = useCallback(async (licenseKey: string) => {
    try {
      const res = await fetch(apiUrl("license/activate"), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...getLaravelAuthHeaders() },
        body: JSON.stringify({ license_key: licenseKey }),
      });
      const json = await res.json();
      const ok = res.ok; // 200 = activated/already_active; 422 = rejected (see LicenseController::activate)
      if (ok) await fetchStatus();
      return { ok, message: json?.message || json?.data?.message || (ok ? "License activated." : "License activation failed.") };
    } catch {
      return { ok: false, message: "Could not reach the license server. Check your internet connection and try again." };
    }
  }, [fetchStatus]);

  return (
    <LicenseContext.Provider
      value={{
        loading,
        blocked: data?.blocked ?? false,
        status: data?.status ?? null,
        message: data?.message ?? null,
        expiresAt: data?.expires_at ?? null,
        refetch: fetchStatus,
        activate,
      }}
    >
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense() {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error("useLicense must be used within a LicenseProvider");
  return ctx;
}
