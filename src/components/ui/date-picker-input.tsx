import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dmyToIso, isoToDmy, isoToLocalDate, localDateToIso, looseDmyToIso, toDateInputValue } from "@/lib/date-format";

export interface DatePickerInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value?: string | number | readonly string[];
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onValueChange?: (isoDate: string) => void;
}

const inputClasses =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:border-accent aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted md:text-sm";

const coerceValue = (value: DatePickerInputProps["value"]): string => {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return value == null ? "" : String(value);
};

export const DatePickerInput = React.forwardRef<HTMLInputElement, DatePickerInputProps>(
  (
    {
      value,
      onChange,
      onValueChange,
      className,
      placeholder = "DD-MM-YYYY",
      disabled,
      readOnly,
      min,
      max,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const iso = toDateInputValue(coerceValue(value));
    const [text, setText] = React.useState(() => isoToDmy(iso));
    const [open, setOpen] = React.useState(false);

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    React.useEffect(() => {
      const nextIso = toDateInputValue(coerceValue(value));
      const nextText = isoToDmy(nextIso);
      setText((prev) => (dmyToIso(prev) === nextIso ? prev : nextText));
    }, [value]);

    const emitChange = React.useCallback(
      (nextIso: string) => {
        onValueChange?.(nextIso);
        if (!onChange) return;

        const event = {
          target: { ...inputRef.current, value: nextIso, name: props.name },
          currentTarget: { ...inputRef.current, value: nextIso, name: props.name },
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
        } as unknown as React.ChangeEvent<HTMLInputElement>;

        onChange(event);
      },
      [onChange, onValueChange, props.name],
    );

    const applyIso = React.useCallback(
      (nextIso: string) => {
        setText(isoToDmy(nextIso));
        emitChange(nextIso);
      },
      [emitChange],
    );

    const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const cleaned = event.target.value.replace(/[^\d\-/.]/g, "");
      const digits = cleaned.replace(/\D/g, "");

      // Raw digits with no separators ("010726", "25122026"): only 8
      // digits (DDMMYYYY) is safe to snap live — 6 digits (DDMMYY) is
      // still ambiguous with the first 6 of an 8-digit entry the user
      // may keep typing, so that case waits for blur (see handleBlur)
      // instead of snapping mid-keystroke and corrupting later input.
      //
      // Deliberately NOT eagerly reformatting already-separated input here
      // (e.g. "1-07-2025" while mid-edit correcting "10-07-2025" to
      // "13-07-2025"): a partial edit can transiently parse as a complete
      // valid date, and snapping it mid-keystroke moves the cursor to the
      // end, so the rest of what's being typed lands in the wrong place.
      // Separated input still resolves correctly on blur (see handleBlur).
      if (digits.length === 8 && digits === cleaned) {
        const parsed = looseDmyToIso(digits);
        if (parsed) {
          setText(isoToDmy(parsed));
          emitChange(parsed);
          return;
        }
      }

      setText(cleaned);
      if (cleaned === "") emitChange("");
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      const parsed = looseDmyToIso(text);
      if (parsed) {
        setText(isoToDmy(parsed));
        emitChange(parsed);
      } else if (text.trim() !== "") {
        setText(isoToDmy(iso));
      }
      onBlur?.(event);
    };

    const selected = isoToLocalDate(iso);
    const minDate = isoToLocalDate(min == null ? "" : String(min));
    const maxDate = isoToLocalDate(max == null ? "" : String(max));

    // Visual invalid state: user typed something that does not parse to a
    // valid DD-MM-YYYY date. Helps prevent saving malformed values.
    const isInvalid = text.trim() !== "" && !dmyToIso(text);

    return (
      <div className={cn("relative", className)}>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          readOnly={readOnly}
          onChange={handleTextChange}
          onBlur={handleBlur}
          aria-invalid={isInvalid || undefined}
          title={isInvalid ? "Invalid date. Use DD-MM-YYYY format." : undefined}
          className={cn(inputClasses, "pr-10", className)}
          {...props}
        />

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Select date"
              className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={disabled || readOnly}
              tabIndex={-1}
            >
              <CalendarIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => {
                if (!date) return;
                applyIso(localDateToIso(date));
                setOpen(false);
              }}
              disabled={(date) => Boolean((minDate && date < minDate) || (maxDate && date > maxDate))}
              initialFocus
              className="pointer-events-auto p-3"
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  },
);

DatePickerInput.displayName = "DatePickerInput";