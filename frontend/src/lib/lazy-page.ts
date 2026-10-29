import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "lazy-page-reload-at";

/**
 * React.lazy for route pages, with one recovery step: if a page chunk fails
 * to load (typically because a deploy replaced the hashed asset files while
 * this tab was open), reload once so the browser picks up the new
 * index.html. A 30s guard stops reload loops when the network is down.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (err) {
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* ignore */ }
      if (Date.now() - last > 30_000) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
