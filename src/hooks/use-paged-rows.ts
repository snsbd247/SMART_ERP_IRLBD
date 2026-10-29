import { useEffect, useMemo, useState } from "react";

/**
 * Client-side pagination for a rows array that's already fully fetched
 * (the sales-workflow list pages pull everything at once — a few hundred
 * rows at most — so slicing on the client is simpler and faster than wiring
 * up server-side paging). Resets to page 1 whenever the row count or page
 * size changes so a stale page can't end up pointing past the end.
 */
export function usePagedRows<T>(rows: T[], initialPageSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, pageSize]);

  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);

  return {
    paged,
    page: safePage,
    setPage,
    pageSize,
    setPageSize: (n: number) => { setPageSize(n); setPage(1); },
    totalPages,
    total: rows.length,
  };
}
