import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface AccountOption {
  id: string;
  account_code: string;
  account_name: string;
}

interface Props {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}

export function AccountCombobox({ accounts, value, onChange, placeholder = "Select account", className }: Props) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-9 w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate">
            {selected ? `${selected.account_code} — ${selected.account_name}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command
          filter={(val, search) => {
            const acc = accounts.find((a) => a.id === val);
            if (!acc) return 0;
            const haystack = `${acc.account_code} ${acc.account_name}`.toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search by code or name..." />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={a.id}
                  onSelect={(v) => { onChange(v); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === a.id ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs mr-2">{a.account_code}</span>
                  <span className="truncate">{a.account_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
