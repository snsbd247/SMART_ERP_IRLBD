import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import {
  Users, Tag, Settings2, ShieldCheck, BookOpen, ScrollText,
  ShoppingCart, FileText, PackageCheck, Receipt, CreditCard, Ship,
} from "lucide-react";

const sections = [
  {
    title: "Foundation",
    items: [
      { to: "/purchase/suppliers", label: "Supplier Master", icon: Users },
      { to: "/purchase/types", label: "Purchase Types", icon: Tag },
      { to: "/purchase/settings", label: "Purchase Settings", icon: Settings2 },
      { to: "/purchase/approval-matrix", label: "Approval Matrix", icon: ShieldCheck },
      { to: "/purchase/coa-mapping", label: "COA Mapping", icon: BookOpen },
      { to: "/purchase/audit-log", label: "Audit Log", icon: ScrollText },
    ],
  },
  {
    title: "Procurement (Phase 2+)",
    items: [
      { to: "/purchase/requisitions", label: "Purchase Requisitions", icon: FileText, soon: true },
      { to: "/purchase/orders", label: "Purchase Orders", icon: ShoppingCart, soon: true },
      { to: "/purchase/grn", label: "GRN", icon: PackageCheck, soon: true },
      { to: "/purchase/bills", label: "Supplier Bills", icon: Receipt, soon: true },
      { to: "/purchase/payments", label: "Supplier Payments", icon: CreditCard, soon: true },
      { to: "/purchase/lc", label: "LC / Import", icon: Ship, soon: true },
    ],
  },
];

const PurchaseDashboardPage = () => (
  <div className="p-6 space-y-6">
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Purchase Management</h1>
      <p className="text-sm text-muted-foreground">Enterprise procurement, GRN, payable & import workflow</p>
    </div>
    {sections.map((sec) => (
      <div key={sec.title} className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{sec.title}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {sec.items.map((it: any) => (
            <Link key={it.to} to={it.soon ? "#" : it.to} className={it.soon ? "pointer-events-none opacity-50" : ""}>
              <Card className="hover:bg-accent/50 transition-colors">
                <CardContent className="p-4 flex items-center gap-3">
                  <it.icon className="w-5 h-5 text-primary" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{it.label}</div>
                    {it.soon && <div className="text-[10px] text-muted-foreground">Coming soon</div>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export default PurchaseDashboardPage;
