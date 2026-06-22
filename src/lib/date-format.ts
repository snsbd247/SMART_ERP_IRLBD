/**
 * Date formatting helpers.
 * UI display for voucher dates uses DD-MM-YYYY while storage / inputs
 * remain ISO (YYYY-MM-DD) so sorting and filtering keep working.
 */
export const formatDateDMY = (d?: string | Date | null): string => {
  if (!d) return "—";
  let s: string;
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    s = `${y}-${m}-${day}`;
  } else {
    s = String(d).slice(0, 10);
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};
