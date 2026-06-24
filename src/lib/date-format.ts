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

export const isoToDmy = (iso?: string | Date | null): string => {
  const normalized = toDateInputValue(iso);
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

export const dmyToIso = (dmy?: string | null): string => {
  if (!dmy) return "";
  const m = String(dmy).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return "";
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export const isoToLocalDate = (iso?: string | Date | null): Date | undefined => {
  const normalized = toDateInputValue(iso);
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

export const localDateToIso = (date?: Date | null): string => {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const formatDateDMY = (d?: string | Date | null): string => {
  if (!d) return "—";
  return isoToDmy(d) || toDateInputValue(d) || "—";
};

/**
 * Strict validator for ISO YYYY-MM-DD strings. Returns the normalized
 * ISO string when valid, or "" otherwise. Use before persisting /
 * sending date values to the backend so malformed input never lands
 * in the database.
 */
export const validateIsoDate = (value?: string | null): string => {
  if (!value) return "";
  const normalized = toDateInputValue(value);
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return "";
  }
  return normalized;
};
