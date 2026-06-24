import * as React from "react";
import { Input } from "@/components/ui/input";
import { toDateInputValue } from "@/lib/date-format";
import { cn } from "@/lib/utils";

/**
 * DateInput
 * - Always displays DD-MM-YYYY regardless of the user's OS/browser locale.
 * - `value` and `onChange` use ISO YYYY-MM-DD for storage compatibility
 *   with the rest of the app (so this is a drop-in replacement for
 *   <Input type="date" />).
 */
export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value?: string;
  onChange?: (isoDate: string) => void;
}

const isoToDmy = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

const dmyToIso = (dmy: string): string => {
  const m = dmy.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return "";
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "";
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, className, placeholder = "DD-MM-YYYY", ...rest }, ref) => {
    const iso = toDateInputValue(value ?? "");
    const [text, setText] = React.useState<string>(isoToDmy(iso));

    // Keep local text in sync when the external ISO value changes.
    React.useEffect(() => {
      const next = isoToDmy(toDateInputValue(value ?? ""));
      setText((prev) => (dmyToIso(prev) === toDateInputValue(value ?? "") ? prev : next));
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      // Allow only digits and separators while typing.
      const cleaned = raw.replace(/[^\d\-/.]/g, "");
      setText(cleaned);
      const parsed = dmyToIso(cleaned);
      if (parsed) onChange?.(parsed);
      else if (cleaned === "") onChange?.("");
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const parsed = dmyToIso(text);
      if (parsed) setText(isoToDmy(parsed));
      rest.onBlur?.(e);
    };

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn(className)}
        {...rest}
      />
    );
  }
);
DateInput.displayName = "DateInput";
