import { Check, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type PurchaseStep = "requisition" | "po" | "grn" | "bill" | "payment";

const STEPS: { id: PurchaseStep; label: string }[] = [
  { id: "requisition", label: "Requisition" },
  { id: "po", label: "Purchase Order" },
  { id: "grn", label: "GRN" },
  { id: "bill", label: "Bill" },
  { id: "payment", label: "Payment" },
];

interface Props {
  current: PurchaseStep;
  /** Map of step → "done" | "active" | "pending" — overrides default linear logic. */
  status?: Partial<Record<PurchaseStep, "done" | "active" | "pending">>;
  className?: string;
}

export function PurchaseStatusTracker({ current, status, className }: Props) {
  const currentIdx = STEPS.findIndex(s => s.id === current);

  return (
    <div className={cn("flex items-center w-full overflow-x-auto py-3", className)}>
      {STEPS.map((s, i) => {
        const st = status?.[s.id] ?? (i < currentIdx ? "done" : i === currentIdx ? "active" : "pending");
        const Icon = st === "done" ? Check : st === "active" ? Clock : Circle;
        return (
          <div key={s.id} className="flex items-center flex-1 min-w-[120px]">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors",
                  st === "done" && "bg-primary text-primary-foreground border-primary",
                  st === "active" && "bg-primary/10 text-primary border-primary",
                  st === "pending" && "bg-muted text-muted-foreground border-muted-foreground/30"
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
              <span className={cn(
                "text-xs mt-1 font-medium whitespace-nowrap",
                st === "pending" && "text-muted-foreground"
              )}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn(
                "h-0.5 flex-1 mx-2 mt-[-18px]",
                i < currentIdx ? "bg-primary" : "bg-muted-foreground/30"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
