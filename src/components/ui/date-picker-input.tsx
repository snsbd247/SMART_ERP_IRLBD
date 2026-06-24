import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dmyToIso, isoToDmy, isoToLocalDate, localDateToIso, toDateInputValue } from "@/lib/date-format";

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
      setText(cleaned);

      const parsed = dmyToIso(cleaned);
      if (parsed) emitChange(parsed);
      else if (cleaned === "") emitChange("");
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      const parsed = dmyToIso(text);
      if (parsed) setText(isoToDmy(parsed));
      else if (text.trim() !== "") setText(isoToDmy(iso));
      onBlur?.(event);
    };

    const selected = isoToLocalDate(iso);
    const minDate = isoToLocalDate(min);
    const maxDate = isoToLocalDate(max);

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