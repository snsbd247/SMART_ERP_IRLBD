import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { FileBarChart } from "lucide-react";

const REPORTS = [
  { to: "/sales-workflow/reports/po-vs-vat-challan", label: "PO vs VAT Challan" },
  { to: "/sales-workflow/reports/pending-po", label: "Pending POs" },
  { to: "/sales-workflow/reports/challan-status", label: "Challan Status Tracker" },
  { to: "/sales-workflow/reports/vat-register", label: "VAT Register (Mushak)" },
  { to: "/sales-workflow/reports/invoice-register", label: "Invoice Register" },
  { to: "/sales-workflow/reports/invoice-pending", label: "Pending Invoices" },
  { to: "/sales-workflow/reports/collection", label: "Collection Report" },
  { to: "/sales-workflow/reports/aging", label: "AR Aging" },
  { to: "/sales-workflow/tds", label: "TDS Register" },
  { to: "/sales-workflow/reports/mushak-9-1", label: "Mushak 9.1 — Monthly VAT Return" },
];

export default function SalesWorkflowReportsIndex() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Sales Workflow Reports</h1>
      <div className="grid md:grid-cols-3 gap-3">
        {REPORTS.map((r) => (
          <Link key={r.to} to={r.to}>
            <Card className="p-4 hover:bg-accent transition-colors flex items-center gap-3">
              <FileBarChart className="w-5 h-5 text-primary" />
              <span className="font-medium">{r.label}</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
