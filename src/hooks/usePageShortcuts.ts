import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PageShortcut {
  id: string;
  shortcut_code: string;
  page_name: string;
  page_url: string;
  module_name: string;
  is_active: boolean;
}

const RECENT_PAGES_KEY = "erp_recent_pages";
const MAX_RECENT = 8;

/**
 * Shared query keys — both TopNavbar and CommandPalette mount this hook
 * simultaneously on every page, so a plain useState/useEffect fetch here
 * used to double every page load's request count AND left each component
 * with its own drifting copy of `favorites` (toggling a favorite in one
 * didn't update the other). Same query key + queryClient mutation for both
 * fixes both problems at once.
 */
const SHORTCUTS_QUERY_KEY = ["page-shortcuts"] as const;
const favoritesQueryKey = (userId: string | undefined) => ["user-favorite-pages", userId] as const;

async function fetchShortcutsList(): Promise<PageShortcut[]> {
  const { data } = await dataClient
    .from("page_shortcuts")
    .select("*")
    .eq("is_active", true)
    .order("shortcut_code");
  return (data as PageShortcut[]) || [];
}

async function fetchFavoritesList(userId: string): Promise<string[]> {
  const { data } = await dataClient.from("user_favorite_pages").select("page_url").eq("user_id", userId);
  return (data || []).map((d: any) => d.page_url);
}

export function usePageShortcuts() {
  const { user, isSuperAdmin, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const { data: shortcuts = [], isLoading: loading, refetch } = useQuery({
    queryKey: SHORTCUTS_QUERY_KEY,
    queryFn: fetchShortcutsList,
    staleTime: 5 * 60 * 1000,
  });

  const favKey = favoritesQueryKey(user?.id);
  const { data: favorites = [] } = useQuery({
    queryKey: favKey,
    queryFn: () => fetchFavoritesList(user!.id),
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  // Filter by permissions
  const adminPaths = ["/admin/"];
  const filteredShortcuts = shortcuts.filter((s) => {
    if (isSuperAdmin) return true;
    if (adminPaths.some((p) => s.page_url.startsWith(p))) {
      return hasPermission("administration", "can_view");
    }
    return true;
  });

  // Recent pages
  const getRecentPages = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_PAGES_KEY) || "[]");
    } catch {
      return [];
    }
  };

  const addRecentPage = (url: string) => {
    const recents = getRecentPages().filter((r) => r !== url);
    recents.unshift(url);
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(recents.slice(0, MAX_RECENT)));
  };

  // Favorites
  const toggleFavorite = async (pageUrl: string) => {
    if (!user) return;
    if (favorites.includes(pageUrl)) {
      await dataClient
        .from("user_favorite_pages")
        .delete()
        .eq("user_id", user.id)
        .eq("page_url", pageUrl);
      queryClient.setQueryData(favKey, (prev: string[] = []) => prev.filter((f) => f !== pageUrl));
    } else {
      await dataClient
        .from("user_favorite_pages")
        .insert({ user_id: user.id, page_url: pageUrl });
      queryClient.setQueryData(favKey, (prev: string[] = []) => [...prev, pageUrl]);
    }
  };

  const isFavorite = (pageUrl: string) => favorites.includes(pageUrl);

  // Search
  const search = (query: string): PageShortcut[] => {
    if (!query.trim()) return filteredShortcuts;
    const q = query.toLowerCase();
    return filteredShortcuts.filter(
      (s) =>
        s.shortcut_code.toLowerCase().includes(q) ||
        s.page_name.toLowerCase().includes(q) ||
        s.module_name.toLowerCase().includes(q)
    );
  };

  // Exact shortcut match
  const findByCode = (code: string): PageShortcut | undefined => {
    return filteredShortcuts.find(
      (s) => s.shortcut_code.toLowerCase() === code.toLowerCase()
    );
  };

  return {
    shortcuts: filteredShortcuts,
    loading,
    search,
    findByCode,
    getRecentPages,
    addRecentPage,
    toggleFavorite,
    isFavorite,
    favorites,
    refetch,
  };
}
