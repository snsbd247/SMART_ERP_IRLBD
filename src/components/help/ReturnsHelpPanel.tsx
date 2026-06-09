import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, ArrowRight, FileText, Package, Receipt, Undo2, Archive } from "lucide-react";

/**
 * Help/Docs panel explaining the new Purchase Returns workflow
 * and where legacy "purchases" references moved to.
 */
export function ReturnsHelpPanel({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const [open, setOpen] = useState(false);

  const steps = [
    { icon: FileText, label: "Requisition", desc: "Internal request for materials.", path: "/purchase-workflow/requisitions" },
    { icon: FileText, label: "Purchase Order", desc: "Approved request sent to supplier.", path: "/purchase-workflow/po" },
    { icon: Package,  label: "GRN", desc: "Goods received and inspected.", path: "/purchase-workflow/grn" },
    { icon: Receipt,  label: "Bill", desc: "Supplier invoice posted to A/P.", path: "/purchase-workflow/bills" },
    { icon: Undo2,    label: "Return", desc: "Reverse received goods / debit note.", path: "/purchase-workflow/returns" },
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant={variant} size="sm" className="gap-1">
          <HelpCircle className="w-4 h-4" /> Help
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Undo2 className="w-5 h-5 text-primary" /> Returns Workflow Guide
          </SheetTitle>
          <SheetDescription>
            The new end-to-end flow for purchases, returns, and where legacy data moved.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-2">Flow</h3>
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={s.label} className="flex items-start gap-3 p-2 rounded-md border bg-muted/30">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <s.icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {i + 1}. {s.label}
                      {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.desc}</p>
                    <a href={s.path} className="text-[11px] text-primary hover:underline">
                      Open {s.label} →
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Archive className="w-4 h-4" /> Legacy Data
            </h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                The old <Badge variant="outline" className="text-[10px]">Purchase Entry</Badge> and{" "}
                <Badge variant="outline" className="text-[10px]">Purchase Return (Legacy)</Badge> screens
                have been removed.
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Old URLs like <code className="text-[11px]">/purchase</code> now redirect here.</li>
                <li>Historical data still appears in <strong>Aging</strong>, <strong>A/P</strong>, and
                  <strong> Supplier Ledger</strong> reports.</li>
                <li>New transactions must go through Bills under the workflow above.</li>
              </ul>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">Permissions</h3>
            <p className="text-xs text-muted-foreground">
              You need <Badge variant="secondary" className="text-[10px]">purchase.view</Badge> to see
              workflow pages, and <Badge variant="secondary" className="text-[10px]">purchase.edit</Badge>
              to create or approve documents.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
