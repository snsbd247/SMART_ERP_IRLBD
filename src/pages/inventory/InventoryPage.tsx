import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Section = ({ title, items }: { title: string; items: { label: string; path: string }[] }) => {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <div className="rounded-md bg-primary text-primary-foreground text-center font-semibold tracking-wider py-2 text-sm">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <Button
            key={it.label}
            variant="outline"
            className="h-11 border-primary/40 text-primary hover:bg-primary/5 hover:text-primary font-medium"
            onClick={() => navigate(it.path)}
          >
            {it.label}
          </Button>
        ))}
      </div>
    </div>
  );
};

const InventoryPage = () => {
  const master = [
    { label: "Stock Groups", path: "/inventory/categories" },
    { label: "Measurment Unit", path: "/inventory/units" },
    { label: "Stock Categories", path: "/inventory/categories" },
    { label: "Voucher Types", path: "/inventory/voucher-types" },
    { label: "Stock Items", path: "/inventory/items" },
    { label: "MFG. Process", path: "/inventory/mfg-processes" },
    { label: "Warehouses", path: "/inventory/warehouses" },
    { label: "Batch/Log Entry", path: "/inventory/batches" },
  ];

  const transactions = [
    { label: "Consumption", path: "/inventory/consumption" },
    { label: "Stock Damage", path: "/inventory/damage" },
    { label: "Finished Goods", path: "/inventory/finished-goods" },
    { label: "Physical Stock", path: "/inventory/physical-stock" },
    { label: "MFG. Voucher", path: "/manufacturing/production" },
    { label: "Stock Transfer", path: "/inventory/transfers" },
    { label: "Stock Adjustment", path: "/inventory/adjustments" },
    { label: "Stock Ledger", path: "/inventory/stock-ledger" },
  ];

  const reports = [
    { label: "Item Master", path: "/inventory/items" },
    { label: "Slow/Fast Moving", path: "/reports/stock-reports" },
    { label: "Stock Summary", path: "/reports/stock-reports" },
    { label: "Out of Stock", path: "/reports/low-stock" },
    { label: "Location Summary", path: "/reports/stock-reports" },
    { label: "Profitability", path: "/reports/financial" },
    { label: "Voucher Reports", path: "/vouchers" },
    { label: "Store Ledger", path: "/reports/stock-ledger" },
    { label: "Stock Movement", path: "/reports/stock-ledger" },
    { label: "Cost Estimation", path: "/manufacturing/bom" },
    { label: "Stock Reorder", path: "/reports/low-stock" },
    { label: "Batch Report", path: "/inventory/batches" },
    { label: "Stock Minimum", path: "/reports/low-stock" },
    { label: "Stock Transfer Register", path: "/inventory/transfers" },
    { label: "MIS Report", path: "/reports/financial" },
  ];

  return (
    <div className="p-6">
      <Card className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Section title="MASTER" items={master} />
          <Section title="TRANSACTIONS" items={transactions} />
          <Section title="REPORTS" items={reports} />
        </div>
      </Card>
    </div>
  );
};

export default InventoryPage;
