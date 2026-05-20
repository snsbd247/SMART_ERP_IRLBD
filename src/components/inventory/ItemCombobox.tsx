import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ItemOption {
  id: string;
  item_code: string;
  item_name: string;
}

interface Props {
  items: ItemOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  size?: "sm" | "default";
}

export function ItemCombobox({ items, value, onChange, placeholder = "Select item", className, size = "default" }: Props) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value);
  const h = size === "sm" ? "h-8 text-xs" : "h-9";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(h, "w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate">
            {selected ? `${selected.item_code} — ${selected.item_name}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command
          filter={(val, search) => {
            const it = items.find((a) => a.id === val);
            if (!it) return 0;
            const haystack = `${it.item_code} ${it.item_name}`.toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search by code or name..." />
          <CommandList>
            <CommandEmpty>No item found.</CommandEmpty>
            <CommandGroup>
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={i.id}
                  onSelect={(v) => { onChange(v); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === i.id ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs mr-2">{i.item_code}</span>
                  <span className="truncate">{i.item_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
