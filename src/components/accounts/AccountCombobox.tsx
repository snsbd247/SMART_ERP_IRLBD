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
  /** Optional: signed running balance (positive = Dr, negative = Cr). */
  signed_balance?: number;
  /** Optional: 'asset' | 'liability' | 'equity' | 'income' | 'expense'. */
  account_type?: string;
}

interface Props {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  /** When true, shows balance + Dr/Cr badge per item. Defaults to true when any account has balance data. */
  showBalance?: boolean;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}

function natureLabel(type?: string, signed?: number): string {
  if (signed === undefined) return "";
  // Debtor = net Dr balance, Creditor = net Cr balance.
  if (signed > 0) return "Dr";
  if (signed < 0) return "Cr";
  return type === "liability" || type === "income" || type === "equity" ? "Cr" : "Dr";
}

export function AccountCombobox({ accounts, value, onChange, placeholder = "Select account", className, showBalance }: Props) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id === value);
  const hasBalances = accounts.some((a) => a.signed_balance !== undefined);
  const display = showBalance ?? hasBalances;

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
      <PopoverContent className="w-[420px] p-0" align="start">
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
              {accounts.map((a) => {
                const nat = natureLabel(a.account_type, a.signed_balance);
                return (
                  <CommandItem
                    key={a.id}
                    value={a.id}
                    onSelect={(v) => { onChange(v); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", value === a.id ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-xs mr-2 shrink-0">{a.account_code}</span>
                    <span className="truncate flex-1">{a.account_name}</span>
                    {display && a.signed_balance !== undefined && (
                      <span className="ml-2 flex items-center gap-1 text-xs shrink-0">
                        <span className={cn("tabular-nums", a.signed_balance < 0 ? "text-destructive" : "text-muted-foreground")}>
                          {a.signed_balance < 0 ? "-" : ""}{fmt(a.signed_balance)}
                        </span>
                        <span className={cn(
                          "rounded px-1 py-0.5 text-[10px] font-medium",
                          nat === "Cr" ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                                       : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                        )}>{nat}</span>
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
