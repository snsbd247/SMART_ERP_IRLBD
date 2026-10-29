import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { dataClient } from "@/integrations/data/client";
import { isLaravelMode, getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

export interface BrandingSettings {
  software_name: string;
  software_version: string;
  footer_text: string;
  developer_name: string;
  white_label_mode: boolean;
  primary_color: string;
  secondary_color: string;
  company_logo_url: string;
  login_logo_url: string;
  favicon_url: string;
}

const DEFAULTS: BrandingSettings = {
  software_name: "SmartERP",
  software_version: "1.0",
  footer_text: "© 2026 SmartERP. All Rights Reserved.",
  developer_name: "Ismail Software Solutions",
  white_label_mode: false,
  // Brand: deep green primary + warm gold secondary/accent
  primary_color: "161 100% 12%",
  secondary_color: "43 55% 54%",
  company_logo_url: "",
  login_logo_url: "",
  favicon_url: "",
};

const BRANDING_KEYS = Object.keys(DEFAULTS) as (keyof BrandingSettings)[];

// ---------- Cache versioning ----------
// Bump CACHE_VERSION when the cached shape changes so stale browsers
// reset cleanly instead of feeding broken values into applyThemeColors.
const CACHE_VERSION = 2;
const CACHE_KEY = "erp-branding-cache";
const LEGACY_KEYS = ["erp-branding-cache-v1"];

interface CachedShape {
  v: number;
  branding: BrandingSettings;
}

function readCache(): BrandingSettings | null {
  try {
    // Drop any legacy unversioned/old-version caches.
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedShape;
    if (!parsed || parsed.v !== CACHE_VERSION || !parsed.branding) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    // Sanity-check the two colors so we never apply garbage.
    if (!parseHsl(parsed.branding.primary_color) || !parseHsl(parsed.branding.secondary_color)) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return { ...DEFAULTS, ...parsed.branding };
  } catch {
    return null;
  }
}

function writeCache(b: BrandingSettings) {
  try {
    const payload: CachedShape = { v: CACHE_VERSION, branding: b };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode — ignore */
  }
}

interface BrandingContextType {
  branding: BrandingSettings;
  loading: boolean;
  refetch: () => Promise<void>;
  /** Live preview: apply colors immediately (rAF-debounced). */
  previewTheme: (primary: string, secondary: string) => void;
  /** Persist current user's color choice to backend + cache. */
  saveUserTheme: (primary: string, secondary: string) => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType>({
  branding: DEFAULTS,
  loading: true,
  refetch: async () => {},
  previewTheme: () => {},
  saveUserTheme: async () => {},
});

export const useBranding = () => useContext(BrandingContext);

export const BrandingProvider = ({ children }: { children: ReactNode }) => {
  const initial = readCache() || DEFAULTS;
  const [branding, setBranding] = useState<BrandingSettings>(initial);
  const [loading, setLoading] = useState(true);

  // Apply cached theme synchronously on first render — no flash.
  if (typeof document !== "undefined") {
    applyThemeColors(initial.primary_color, initial.secondary_color);
    applyFavicon(initial.favicon_url);
  }

  const fetchBranding = useCallback(async () => {
    let rows: { setting_key: string; setting_value: string | null }[] = [];

    try {
      if (isLaravelMode()) {
        const base = getApiBaseUrl() || "";
        const res = await fetch(`${base}/v1/public/branding`, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          rows = payload?.data || [];
        }
      } else {
        const { data } = await dataClient
          .from("system_settings")
          .select("setting_key, setting_value")
          .in("setting_key", BRANDING_KEYS);
        rows = (data as any) || [];
      }
    } catch {
      /* fall back to cache / defaults */
    }

    const merged = { ...DEFAULTS };
    if (rows.length > 0) {
      rows.forEach((row) => {
        const key = row.setting_key as keyof BrandingSettings;
        if (!(key in DEFAULTS)) return;
        if (key === "white_label_mode") {
          (merged as any)[key] = row.setting_value === "true";
        } else {
          (merged as any)[key] = row.setting_value || DEFAULTS[key];
        }
      });
    }

    // Per-user override (only when logged in) wins over system-wide branding.
    try {
      const { data: { user } } = await dataClient.auth.getUser();
      if (user) {
        const { data: pref } = await dataClient
          .from("user_theme_preferences")
          .select("primary_color, secondary_color")
          .eq("user_id", user.id)
          .maybeSingle();
        if (pref?.primary_color) merged.primary_color = pref.primary_color;
        if (pref?.secondary_color) merged.secondary_color = pref.secondary_color;
      }
    } catch {
      /* unauthenticated or table missing — ignore */
    }

    setBranding(merged);
    writeCache(merged);
    applyThemeColors(merged.primary_color, merged.secondary_color);
    applyFavicon(merged.favicon_url);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBranding();
    // Re-load when auth state changes so each user gets their own theme.
    const { data: sub } = dataClient.auth.onAuthStateChange(() => {
      fetchBranding();
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchBranding]);

  // Re-derive tokens whenever the html `dark` class flips.
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      applyThemeColors(branding.primary_color, branding.secondary_color);
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [branding.primary_color, branding.secondary_color]);

  // ---------- Debounced live preview (rAF coalesces rapid changes) ----------
  const pendingRef = useRef<{ p: string; s: string } | null>(null);
  const rafRef = useRef<number | null>(null);
  const previewTheme = useCallback((primary: string, secondary: string) => {
    pendingRef.current = { p: primary, s: secondary };
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) applyThemeColors(pending.p, pending.s);
    });
  }, []);

  const saveUserTheme = useCallback(async (primary: string, secondary: string) => {
    // Always update cache so the next page-load is instant.
    const next = { ...branding, primary_color: primary, secondary_color: secondary };
    setBranding(next);
    writeCache(next);
    applyThemeColors(primary, secondary);

    try {
      const { data: { user } } = await dataClient.auth.getUser();
      if (!user) return;
      await dataClient
        .from("user_theme_preferences")
        .upsert(
          { user_id: user.id, primary_color: primary, secondary_color: secondary },
          { onConflict: "user_id" },
        );
    } catch {
      /* offline / unauthenticated — cache already saved */
    }
  }, [branding]);

  return (
    <BrandingContext.Provider value={{ branding, loading, refetch: fetchBranding, previewTheme, saveUserTheme }}>
      {children}
    </BrandingContext.Provider>
  );
};

/** Parse "H S% L%" → [h, s, l]. Returns null if unparseable. */
export function parseHsl(value: string): [number, number, number] | null {
  if (!value) return null;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%?\s+(-?\d+(?:\.\d+)?)%?$/);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

const fmt = (h: number, s: number, l: number) =>
  `${Math.round(h)} ${Math.round(Math.max(0, Math.min(100, s)))}% ${Math.round(Math.max(0, Math.min(100, l)))}%`;

/** WCAG contrast ratio between two HSL strings ("H S% L%"). */
export function contrastRatio(a: string, b: string): number {
  const toRgb = (hsl: string) => {
    const p = parseHsl(hsl);
    if (!p) return [0, 0, 0];
    const [h, s, l] = [p[0], p[1] / 100, p[2] / 100];
    const k = (n: number) => (n + h / 30) % 12;
    const aa = s * Math.min(l, 1 - l);
    const f = (n: number) => l - aa * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  };
  const lum = (rgb: number[]) => {
    const [r, g, bl] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const L1 = lum(toRgb(a));
  const L2 = lum(toRgb(b));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Apply branding colors across the entire design-system token set.
 * Exported so the Branding page can drive a live preview.
 */
export function applyThemeColors(primary: string, secondary: string) {
  const p = parseHsl(primary);
  if (!p) return;
  const [ph, ps, pl] = p;
  const s = parseHsl(secondary) || [ph, Math.min(100, ps + 10), 92];
  const [sh, ss, sl] = s;

  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  const primaryFg = pl < 50 ? fmt(sh, Math.max(20, ss - 10), 95) : fmt(ph, 100, 10);
  const accentFg = sl < 50 ? fmt(ph, 30, 95) : fmt(ph, 100, 12);

  set("--primary", fmt(ph, ps, pl));
  set("--primary-foreground", primaryFg);
  set("--primary-glow", fmt(ph, Math.max(40, ps - 20), Math.min(85, pl + 12)));

  set("--secondary", fmt(sh, ss, sl));
  set("--secondary-foreground", accentFg);

  set("--accent", fmt(sh, ss, sl));
  set("--accent-foreground", accentFg);

  set("--ring", fmt(sh, ss, sl));

  set("--sidebar-primary", fmt(sh, ss, sl));
  set("--sidebar-primary-foreground", fmt(ph, 100, Math.max(8, pl)));
  set("--sidebar-ring", fmt(sh, ss, sl));

  set(
    "--gradient-primary",
    `linear-gradient(135deg, hsl(${fmt(ph, ps, pl)}), hsl(${fmt(ph, Math.max(40, ps - 20), Math.min(80, pl + 10))}))`,
  );
  set(
    "--gradient-accent",
    `linear-gradient(135deg, hsl(${fmt(sh, ss, sl)}), hsl(${fmt(sh, Math.min(100, ss + 10), Math.min(85, sl + 10))}))`,
  );
  set("--shadow-glow", `0 0 24px hsl(${fmt(ph, ps, pl)} / 0.25)`);

  const isDark = root.classList.contains("dark");
  if (isDark) {
    set("--background", fmt(ph, 35, 6));
    set("--card", fmt(ph, 35, 8));
    set("--popover", fmt(ph, 35, 8));
    set("--muted", fmt(ph, 25, 12));
    set("--border", fmt(ph, 30, 16));
    set("--input", fmt(ph, 30, 16));
    set("--sidebar-background", fmt(ph, 50, 5));
    set("--sidebar-foreground", fmt(sh, 30, 85));
    set("--sidebar-accent", fmt(ph, 40, 12));
    set("--sidebar-accent-foreground", fmt(sh, ss, 70));
    set("--sidebar-border", fmt(ph, 30, 14));
  } else {
    set("--background", "0 0% 100%");
    set("--card", "0 0% 100%");
    set("--popover", "0 0% 100%");
    set("--muted", fmt(ph, 15, 96));
    set("--border", fmt(ph, 15, 88));
    set("--input", fmt(ph, 15, 88));
    set("--sidebar-background", fmt(ph, ps, pl));
    set("--sidebar-foreground", fmt(sh, 35, 88));
    set("--sidebar-accent", fmt(ph, Math.max(40, ps - 20), Math.min(30, pl + 6)));
    set("--sidebar-accent-foreground", fmt(sh, ss, 88));
    set("--sidebar-border", fmt(ph, Math.max(40, ps - 40), Math.min(30, pl + 6)));
  }
}

function applyFavicon(url: string) {
  if (!url) return;
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}
