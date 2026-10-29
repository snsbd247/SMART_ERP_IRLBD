import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Download, ShoppingCart, Loader2, RefreshCw, Truck } from "lucide-react";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { ListPagination } from "@/components/sales-workflow/ListPagination";

const API_BASE = getApiBaseUrl() || "";

type Kind = "sales" | "purchase" | "vat-challans";

interface Row {
  key: string;
  ref_label: string;
  date?: string;
  party_name: string;
  subtotal: number;
  vat_amount: number;
  grand_total: number;
  items_count: number;
}

const KIND_CONFIG: Record<Kind, { title: string; partyLabel: string; listUrl: string; importUrl: string; paramName: string; toRow: (r: any) => Row }> = {
  sales: {
    title: "Pending Sales Invoices",
    partyLabel: "Customer",
    listUrl: "/v1/vat-import/sales",
    importUrl: "/v1/vat-import/sales/import",
    paramName: "ids",
    toRow: (r) => ({ key: r.id, ref_label: r.source_ref_no, date: r.invoice_date, party_name: r.party_name, subtotal: r.subtotal, vat_amount: r.vat_amount, grand_total: r.grand_total, items_count: r.items_count }),
  },
  purchase: {
    title: "Pending Purchase Bills",
    partyLabel: "Supplier",
    listUrl: "/v1/vat-import/purchase",
    importUrl: "/v1/vat-import/purchase/import",
    paramName: "ids",
    toRow: (r) => ({ key: r.id, ref_label: r.source_ref_no, date: r.bill_date, party_name: r.party_name, subtotal: r.subtotal, vat_amount: r.vat_amount, grand_total: r.grand_total, items_count: r.items_count }),
  },
  "vat-challans": {
    title: "Pending VAT Challans",
    partyLabel: "Customer",
    listUrl: "/v1/vat-import/vat-challans",
    importUrl: "/v1/vat-import/vat-challans/import",
    paramName: "challan_nos",
    toRow: (r) => ({ key: r.challan_no, ref_label: r.challan_no, date: r.invoice_date, party_name: r.party_name, subtotal: r.subtotal, vat_amount: r.vat_amount, grand_total: r.grand_total, items_count: r.items_count }),
  },
};

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

function formatDate(d?: string): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

async function apiCall(url: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...getLaravelAuthHeaders(), ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}

const VatImportPage = () => {
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<Kind>("sales");
  const [rowsByKind, setRowsByKind] = useState<Record<Kind, Row[]>>({ sales: [], purchase: [], "vat-challans": [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<Kind, Set<string>>>({ sales: new Set(), purchase: new Set(), "vat-challans": new Set() });
  const [importing, setImporting] = useState(false);

  // usePagedRows must be called unconditionally at the top level (not once
  // per tab inside renderTable) — one instance per kind, keyed the same way.
  const pagination: Record<Kind, ReturnType<typeof usePagedRows<Row>>> = {
    sales: usePagedRows(rowsByKind.sales),
    purchase: usePagedRows(rowsByKind.purchase),
    "vat-challans": usePagedRows(rowsByKind["vat-challans"]),
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, v] = await Promise.all([
        apiCall(KIND_CONFIG.sales.listUrl),
        apiCall(KIND_CONFIG.purchase.listUrl),
        apiCall(KIND_CONFIG["vat-challans"].listUrl),
      ]);
      setRowsByKind({
        sales: (s.data || []).map(KIND_CONFIG.sales.toRow),
        purchase: (p.data || []).map(KIND_CONFIG.purchase.toRow),
        "vat-challans": (v.data || []).map(KIND_CONFIG["vat-challans"].toRow),
      });
      setSelected({ sales: new Set(), purchase: new Set(), "vat-challans": new Set() });
    } catch (err: any) {
      toast({ title: "Could not load pending records", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggle = (kind: Kind, key: string) => {
    setSelected((prev) => {
      const next = new Set(prev[kind]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [kind]: next };
    });
  };

  const toggleAll = (kind: Kind) => {
    setSelected((prev) => {
      const pageKeys = pagination[kind].paged.map((r) => r.key);
      const allOnPageSelected = pageKeys.length > 0 && pageKeys.every((k) => prev[kind].has(k));
      const next = new Set(prev[kind]);
      pageKeys.forEach((k) => (allOnPageSelected ? next.delete(k) : next.add(k)));
      return { ...prev, [kind]: next };
    });
  };

  const handleImport = async (kind: Kind) => {
    const keys = Array.from(selected[kind]);
    if (keys.length === 0) {
      toast({ title: "Select at least one record", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const cfg = KIND_CONFIG[kind];
      const result = await apiCall(cfg.importUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [cfg.paramName]: keys }),
      });
      const rows: any[] = result.data || [];
      const ok = rows.filter((r) => r.ok).length;
      const failed = rows.filter((r) => !r.ok);
      toast({
        title: `${ok} of ${rows.length} imported`,
        description: failed.length ? `Failed: ${failed.map((f) => f.error).join("; ")}` : "All selected records imported successfully.",
        variant: failed.length ? "destructive" : "default",
      });
      fetchAll();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
    setImporting(false);
  };

  if (!isSuperAdmin) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-destructive font-medium">Access Denied</p>
          <p className="text-sm text-muted-foreground">Only Super Admins can access VAT Data Import.</p>
        </div>
      </div>
    );
  }

  const renderTable = (kind: Kind) => {
    const cfg = KIND_CONFIG[kind];
    const rows = rowsByKind[kind];
    const sel = selected[kind];
    const { paged, page, setPage, pageSize, setPageSize, totalPages, total } = pagination[kind];
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {kind === "vat-challans" ? <Truck className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
              {cfg.title}
            </CardTitle>
            <CardDescription>
              {kind === "vat-challans"
                ? "Importing here only creates the Customer PO + VAT Challan + Delivery Challan (left as a fresh, not-yet-received delivery) — advance it further from the Delivery Challans / Customer Receive / HO Receive pages."
                : "Only records not yet imported are shown here — once imported, they disappear from this list."}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => handleImport(kind)} disabled={importing || sel.size === 0}>
              {importing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
              Import Selected ({sel.size})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No pending records. Everything has been imported, or nothing has been pulled from the VAT software yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={paged.length > 0 && paged.every((r) => sel.has(r.key))} onCheckedChange={() => toggleAll(kind)} />
                    </TableHead>
                    <TableHead>{kind === "vat-challans" ? "Challan No" : "Ref No"}</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>{cfg.partyLabel}</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((r) => (
                    <TableRow key={r.key} className={sel.has(r.key) ? "bg-muted/50" : ""}>
                      <TableCell><Checkbox checked={sel.has(r.key)} onCheckedChange={() => toggle(kind, r.key)} /></TableCell>
                      <TableCell className="font-mono text-xs">{r.ref_label}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate">{r.party_name}</TableCell>
                      <TableCell className="text-right text-xs">{formatMoney(r.subtotal)}</TableCell>
                      <TableCell className="text-right text-xs">{formatMoney(r.vat_amount)}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatMoney(r.grand_total)}</TableCell>
                      <TableCell className="text-center"><Badge variant="outline" className="text-xs">{r.items_count}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ListPagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">VAT Data Import</h1>
        <p className="text-sm text-muted-foreground">Review Sales, Purchase, and VAT Challan records pulled from the VAT software, then select which ones to bring into SmartERP.</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Kind)}>
        <TabsList>
          <TabsTrigger value="sales">Sales ({rowsByKind.sales.length})</TabsTrigger>
          <TabsTrigger value="vat-challans">VAT Challans ({rowsByKind["vat-challans"].length})</TabsTrigger>
          <TabsTrigger value="purchase">Purchase ({rowsByKind.purchase.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="sales">{renderTable("sales")}</TabsContent>
        <TabsContent value="vat-challans">{renderTable("vat-challans")}</TabsContent>
        <TabsContent value="purchase">{renderTable("purchase")}</TabsContent>
      </Tabs>
    </div>
  );
};

export default VatImportPage;
