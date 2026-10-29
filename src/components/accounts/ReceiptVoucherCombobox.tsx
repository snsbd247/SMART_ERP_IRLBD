import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ReceiptVoucherOption {
  id: string;
  voucher_number: string;
  voucher_date: string;
  total_amount: number;
}

interface Props {
  vouchers: ReceiptVoucherOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  className?: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

export function ReceiptVoucherCombobox({ vouchers, value, onChange, placeholder = "Link a Receipt Voucher (optional)", className }: Props) {
  const [open, setOpen] = useState(false);
  const selected = vouchers.find((v) => v.id === value);

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
            {selected ? `${selected.voucher_number} — ${fmt(selected.total_amount)} (${selected.voucher_date})` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command
          filter={(val, search) => {
            const v = vouchers.find((x) => x.id === val);
            if (!v) return 0;
            return v.voucher_number.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search voucher number..." />
          <CommandList>
            <CommandEmpty>No receipt voucher found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none__" onSelect={() => { onChange(null); setOpen(false); }}>
                <Check className={cn("mr-2 h-4 w-4 shrink-0", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">None</span>
              </CommandItem>
              {vouchers.map((v) => (
                <CommandItem key={v.id} value={v.id} onSelect={(id) => { onChange(id); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === v.id ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs mr-2 shrink-0">{v.voucher_number}</span>
                  <span className="text-xs text-muted-foreground mr-2 shrink-0">{v.voucher_date}</span>
                  <span className="ml-auto tabular-nums text-xs shrink-0">{fmt(v.total_amount)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
