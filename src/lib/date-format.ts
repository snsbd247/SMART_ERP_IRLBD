/**
 * Date formatting helpers.
 * UI display for voucher dates uses DD-MM-YYYY while storage / inputs
 * remain ISO (YYYY-MM-DD) so sorting and filtering keep working.
 *
 * NOTE: Some backends (Laravel/Carbon) serialize DATE columns as full
 * ISO timestamps in UTC (e.g. "2026-07-09T18:00:00.000000Z" for a
 * stored date of 2026-07-10 in Asia/Dhaka). A naive `.slice(0, 10)`
 * would shift such values one day backwards. The helpers below detect
 * timestamp strings and resolve them in the local timezone so the
 * calendar date round-trips correctly through the date input.
 */

/** Returns YYYY-MM-DD suitable for `<input type="date">`. */
export const toDateInputValue = (d?: string | Date | null): string => {
  if (!d) return "";
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const s = String(d);
  // Plain date string already in YYYY-MM-DD form: keep as-is (no TZ math).
  const plain = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plain) return `${plain[1]}-${plain[2]}-${plain[3]}`;
  // Datetime string with explicit time component: parse and use local
  // calendar date (avoids the UTC->local off-by-one shift).
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return toDateInputValue(dt);
  return s.slice(0, 10);
};

export const formatDateDMY = (d?: string | Date | null): string => {
  if (!d) return "—";
  const iso = toDateInputValue(d);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso || "—";
};
