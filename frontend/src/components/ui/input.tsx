import * as React from "react";

import { DatePickerInput } from "@/components/ui/date-picker-input";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    if (type === "date") {
      return <DatePickerInput ref={ref} className={className} {...props} />;
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:border-accent aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
