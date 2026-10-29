import * as React from "react";
import { DatePickerInput } from "@/components/ui/date-picker-input";

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

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, ...rest }, ref) => (
    <DatePickerInput ref={ref} value={value} onValueChange={onChange} {...rest} />
  ),
);
DateInput.displayName = "DateInput";
