import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface CustomerOption {
  id: string;
  name: string;
  address?: string | null;
}

interface Props {
  customers: CustomerOption[];
  value: string | null;
  onChange: (id: string | null, customer: CustomerOption | null) => void;
  placeholder?: string;
  className?: string;
}

export function CustomerCombobox({ customers, value, onChange, placeholder = "Select customer...", className }: Props) {
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-9 w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command
          filter={(val, search) => {
            const c = customers.find((x) => x.id === val);
            if (!c) return 0;
            return c.name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search customer..." />
          <CommandList>
            <CommandEmpty>No customer found.</CommandEmpty>
            <CommandGroup>
              {customers.map((c) => (
                <CommandItem key={c.id} value={c.id} onSelect={(id) => { onChange(id, c); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
