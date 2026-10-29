import { useEffect, useMemo, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Search, ClipboardList, Pencil, Trash2, FileText, Download } from "lucide-react";
import { AccountCombobox } from "@/components/accounts/AccountCombobox";
import { ItemCombobox } from "@/components/inventory/ItemCombobox";
import { generateBomPdf } from "@/lib/bom-pdf";
import { useCompanySettings } from "@/hooks/useCompanySettings";

interface ItemRow { id: string; item_name: string; item_code: string; unit_id: string | null; cost_price: number | null; }
interface UnitRow { id: string; name: string; abbreviation: string | null; }
interface AccountRow { id: string; account_code: string; account_name: string; account_type: string; }
interface BomItemRow { id?: string; material_id: string; required_qty: number; wastage_pct: number; unit_price: number; unit: string; }
interface BomExpenseRow { id?: string; account_id: string; rate: number; }
interface BomRow {
  id: string; bom_number: string | null; name: string; product_id: string;
  uom_id: string | null; previous_rate: number | null; current_rate: number | null;
  notes: string | null; created_at: string;
  product?: { item_name: string; item_code: string } | null;
  uom?: { abbreviation: string | null; name: string } | null;
}

const fmt = (n: number, d = 4) => (Number.isFinite(n) ? n : 0).toFixed(d);

const BOMPage = () => {
  const { settings } = useCompanySettings();
  const [boms, setBoms] = useState<BomRow[]>([]);
  const [products, setProducts] = useState<ItemRow[]>([]);
  const [materials, setMaterials] = useState<ItemRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nextBomNumber, setNextBomNumber] = useState<string>("");

  const [form, setForm] = useState({ bom_number: "", name: "", product_id: "", uom_id: "", previous_rate: 0, notes: "" });
  const [items, setItems] = useState<BomItemRow[]>([]);
  const [expenses, setExpenses] = useState<BomExpenseRow[]>([]);

  const [previewBom, setPreviewBom] = useState<BomRow | null>(null);
  const [previewItems, setPreviewItems] = useState<BomItemRow[]>([]);
  const [previewExp, setPreviewExp] = useState<BomExpenseRow[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    const [bomRes, prodRes, unitRes, accRes] = await Promise.all([
      dataClient.from("bill_of_materials").select("*, product:item_master!bill_of_materials_product_id_fkey(item_name, item_code), uom:units(name, abbreviation)").order("created_at", { ascending: false }),
      dataClient.from("item_master").select("id, item_name, item_code, unit_id, cost_price").eq("status", "active").order("item_name"),
      dataClient.from("units").select("id, name, abbreviation").order("name"),
      dataClient.from("chart_of_accounts").select("id, account_code, account_name, account_type").eq("is_active", true).eq("account_type", "expense").order("account_code"),
    ]);
    setBoms(((bomRes.data || []) as unknown) as BomRow[]);
    const items = (prodRes.data || []) as unknown as ItemRow[];
    setProducts(items);
    setMaterials(items);
    setUnits(((unitRes.data || []) as unknown) as UnitRow[]);
    setAccounts(((accRes.data || []) as unknown) as AccountRow[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const computeNextBomNumber = async () => {
    const { data } = await dataClient.from("number_sequences").select("id, prefix, current_number, year").eq("id", "bom").maybeSingle();
    if (!data) {
      const year = new Date().getFullYear().toString().slice(-2) + String(new Date().getFullYear() + 1).slice(-2);
      return `BOM-${year}-00001`;
    }
    const next = (data.current_number || 0) + 1;
    return `${data.prefix}-${data.year}-${String(next).padStart(5, "0")}`;
  };

  const openCreate = async () => {
    setEditId(null);
    const num = await computeNextBomNumber();
    setNextBomNumber(num);
    setForm({ bom_number: num, name: "", product_id: "", uom_id: "", previous_rate: 0, notes: "" });
    setItems([{ material_id: "", required_qty: 0, wastage_pct: 0, unit_price: 0, unit: "" }]);
    setExpenses([{ account_id: "", rate: 0 }]);
    setDialogOpen(true);
  };

  const openEdit = async (bom: BomRow) => {
    setEditId(bom.id);
    const [itRes, exRes] = await Promise.all([
      dataClient.from("bom_items").select("*").eq("bom_id", bom.id),
      (dataClient.from as any)("bom_expenses").select("*").eq("bom_id", bom.id),
    ]);
    setForm({
      bom_number: bom.bom_number || "",
      name: bom.name,
      product_id: bom.product_id,
      uom_id: bom.uom_id || "",
      previous_rate: Number(bom.previous_rate) || 0,
      notes: bom.notes || "",
    });
    setItems(((itRes.data || []) as any[]).map((i) => ({
      id: i.id, material_id: i.material_id,
      required_qty: Number(i.quantity) || 0,
      wastage_pct: Number(i.wastage_pct) || 0,
      unit_price: Number(i.unit_price) || 0,
      unit: i.unit || "",
    })));
    setExpenses(((exRes.data || []) as any[]).map((e) => ({ id: e.id, account_id: e.account_id, rate: Number(e.rate) || 0 })));
    setDialogOpen(true);
  };

  // Auto-fill UOM + previous rate when product changes
  const handleProductChange = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    setForm((f) => ({
      ...f,
      product_id: productId,
      uom_id: p?.unit_id || "",
      previous_rate: Number(p?.cost_price) || 0,
      name: f.name || (p ? `BOM - ${p.item_name}` : ""),
    }));
  };

  const handleMaterialChange = (idx: number, materialId: string) => {
    const m = materials.find((x) => x.id === materialId);
    const u = units.find((x) => x.id === m?.unit_id);
    const next = [...items];
    next[idx] = { ...next[idx], material_id: materialId, unit_price: Number(m?.cost_price) || next[idx].unit_price, unit: u?.abbreviation || u?.name || next[idx].unit };
    setItems(next);
  };

  const wastageQty = (it: BomItemRow) => (it.required_qty * it.wastage_pct) / 100;
  const actualQty = (it: BomItemRow) => it.required_qty - wastageQty(it);
  const itemTotal = (it: BomItemRow) => actualQty(it) * it.unit_price;

  const rmTotalAmount = useMemo(() => items.reduce((s, i) => s + itemTotal(i), 0), [items]);
  const expTotal = useMemo(() => expenses.reduce((s, e) => s + (Number(e.rate) || 0), 0), [expenses]);
  const currentRate = rmTotalAmount + expTotal;

  const uomLabel = (id: string | null | undefined) => {
    const u = units.find((x) => x.id === id);
    return u ? (u.abbreviation || u.name) : "";
  };

  const handleSave = async () => {
    if (!form.product_id || items.some((i) => !i.material_id)) {
      toast.error("Please fill in the finished product and all materials");
      return;
    }
    const finalName = form.name || `BOM - ${products.find((p) => p.id === form.product_id)?.item_name || ""}`;
    const payload: any = {
      bom_number: form.bom_number,
      name: finalName,
      product_id: form.product_id,
      uom_id: form.uom_id || null,
      previous_rate: form.previous_rate,
      current_rate: currentRate,
      notes: form.notes || null,
    };

    if (editId) {
      await (dataClient.from("bill_of_materials") as any).update(payload).eq("id", editId);
      await dataClient.from("bom_items").delete().eq("bom_id", editId);
      await (dataClient.from as any)("bom_expenses").delete().eq("bom_id", editId);
      await dataClient.from("bom_items").insert(items.map((i) => ({
        bom_id: editId, material_id: i.material_id, quantity: i.required_qty,
        wastage_pct: i.wastage_pct, unit_price: i.unit_price, unit: i.unit || "pcs",
      })) as any);
      if (expenses.some((e) => e.account_id)) {
        await (dataClient.from as any)("bom_expenses").insert(expenses.filter((e) => e.account_id).map((e) => ({ bom_id: editId, account_id: e.account_id, rate: e.rate })));
      }
      toast.success("BOM updated");
    } else {
      const { data, error } = await dataClient.from("bill_of_materials").insert(payload as any).select().single();
      if (error || !data) { toast.error(error?.message || "Failed"); return; }
      const newId = (data as any).id;
      await dataClient.from("bom_items").insert(items.map((i) => ({
        bom_id: newId, material_id: i.material_id, quantity: i.required_qty,
        wastage_pct: i.wastage_pct, unit_price: i.unit_price, unit: i.unit || "pcs",
      })) as any);
      if (expenses.some((e) => e.account_id)) {
        await (dataClient.from as any)("bom_expenses").insert(expenses.filter((e) => e.account_id).map((e) => ({ bom_id: newId, account_id: e.account_id, rate: e.rate })));
      }
      // bump number sequence
      const seq = await dataClient.from("number_sequences").select("id, current_number").eq("id", "bom").maybeSingle();
      if (seq.data?.id) {
        const cur = (seq.data.current_number || 0) + 1;
        await (dataClient.from("number_sequences") as any).update({ current_number: cur }).eq("id", seq.data.id);
      }
      toast.success(`BOM created: ${form.bom_number}`);
    }
    setDialogOpen(false);
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this BOM?")) return;
    await dataClient.from("bill_of_materials").delete().eq("id", id);
    toast.success("BOM deleted");
    fetchAll();
  };

  const openPreview = async (bom: BomRow) => {
    const [itRes, exRes] = await Promise.all([
      dataClient.from("bom_items").select("*, material:item_master(item_name, item_code)").eq("bom_id", bom.id),
      (dataClient.from as any)("bom_expenses").select("*, account:chart_of_accounts(account_code, account_name)").eq("bom_id", bom.id),
    ]);
    setPreviewBom(bom);
    setPreviewItems(((itRes.data || []) as any[]).map((i) => ({
      id: i.id, material_id: i.material_id,
      required_qty: Number(i.quantity) || 0,
      wastage_pct: Number(i.wastage_pct) || 0,
      unit_price: Number(i.unit_price) || 0,
      unit: i.unit || "",
      // attach extras for render
      ...(i as any),
    })) as any);
    setPreviewExp(((exRes.data || []) as any[]) as any);
  };

  const buildPdfData = (bom: BomRow, its: any[], exps: any[]) => ({
    bom_number: bom.bom_number || "",
    product_name: bom.product?.item_name || "",
    uom: bom.uom?.abbreviation || bom.uom?.name || "",
    previous_rate: Number(bom.previous_rate) || 0,
    current_rate: Number(bom.current_rate) || 0,
    notes: bom.notes,
    company_name: settings?.company_name,
    items: its.map((i: any) => {
      const req = Number(i.required_qty ?? i.quantity) || 0;
      const wp = Number(i.wastage_pct) || 0;
      const wq = (req * wp) / 100;
      const aq = req - wq;
      const up = Number(i.unit_price) || 0;
      return {
        code: i.material?.item_code || "—",
        name: i.material?.item_name || "—",
        unit: i.unit || "",
        required_qty: req, wastage_pct: wp, wastage_qty: wq,
        actual_qty: aq, unit_price: up, total: aq * up,
      };
    }),
    expenses: exps.map((e: any) => ({
      code: e.account?.account_code || "—",
      name: e.account?.account_name || "—",
      rate: Number(e.rate) || 0,
    })),
  });

  const handlePdf = async (bom: BomRow, mode: "open" | "save" = "open") => {
    const [itRes, exRes] = await Promise.all([
      dataClient.from("bom_items").select("*, material:item_master(item_name, item_code)").eq("bom_id", bom.id),
      (dataClient.from as any)("bom_expenses").select("*, account:chart_of_accounts(account_code, account_name)").eq("bom_id", bom.id),
    ]);
    const its = ((itRes.data || []) as any[]).map((i) => ({ ...i, required_qty: Number(i.quantity) || 0 }));
    generateBomPdf(buildPdfData(bom, its, (exRes.data || []) as any[]), mode);
  };

  const handlePreviewPdf = (mode: "open" | "save" = "open") => {
    if (!previewBom) return;
    const its = previewItems.map((i: any) => ({ ...i, material: i.material }));
    generateBomPdf(buildPdfData(previewBom, its, previewExp as any[]), mode);
  };

  const filtered = boms.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.bom_number || "").toLowerCase().includes(search.toLowerCase())
  );

  const selectedProduct = products.find((p) => p.id === form.product_id);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Bill of Materials</h1>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />New BOM</Button>
      </div>

      <div className="relative max-w-sm print:hidden">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search BOMs..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card className="print:hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>BOM #</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Prev Rate</TableHead>
                <TableHead className="text-right">Current Rate</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No BOMs found</TableCell></TableRow>
              ) : filtered.map((bom) => (
                <TableRow key={bom.id}>
                  <TableCell className="font-mono text-xs">{bom.bom_number || "—"}</TableCell>
                  <TableCell className="font-medium">{bom.name}</TableCell>
                  <TableCell>{bom.product?.item_name || "—"}</TableCell>
                  <TableCell>{bom.uom?.abbreviation || bom.uom?.name || "—"}</TableCell>
                  <TableCell className="text-right">{fmt(Number(bom.previous_rate) || 0, 4)}</TableCell>
                  <TableCell className="text-right">{fmt(Number(bom.current_rate) || 0, 4)}</TableCell>
                  <TableCell className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openPreview(bom)} title="Preview"><FileText className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handlePdf(bom, "save")} title="Download PDF"><Download className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(bom)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(bom.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ===== Create/Edit Dialog ===== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[1400px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit BOM" : "Create BOM"}</DialogTitle>
          </DialogHeader>

          {/* Header fields */}
          <div className="grid grid-cols-12 gap-3 items-center">
            <Label className="col-span-2 text-right">Bill of Materials SL:</Label>
            <Input className="col-span-4" value={form.bom_number} onChange={(e) => setForm({ ...form, bom_number: e.target.value })} />
            <div className="col-span-6" />

            <Label className="col-span-2 text-right">Finished Product:</Label>
            <div className="col-span-4">
              <ItemCombobox
                items={products}
                value={form.product_id}
                onChange={handleProductChange}
                placeholder="Search by code or name..."
              />
            </div>
            <div className="col-span-6" />

            <Label className="col-span-2 text-right">UOM:</Label>
            <Input className="col-span-4 bg-muted" readOnly value={uomLabel(form.uom_id)} placeholder="Auto from product" />
            <div className="col-span-6" />

            <Label className="col-span-2 text-right">Previous Rate:</Label>
            <Input className="col-span-2 bg-muted text-right" readOnly value={fmt(form.previous_rate, 4)} />
            <div className="col-span-8" />

            <Label className="col-span-2 text-right">Current Rate:</Label>
            <Input className="col-span-2 bg-muted text-right font-semibold" readOnly value={fmt(currentRate, 4)} />
            <div className="col-span-8" />
          </div>

          {/* Two-column tables */}
          <div className="grid grid-cols-12 gap-4 mt-4">
            {/* RM/PM List */}
            <div className="col-span-8 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-base">RM/PM List</Label>
                <Button variant="outline" size="sm" onClick={() => setItems([...items, { material_id: "", required_qty: 0, wastage_pct: 0, unit_price: 0, unit: "" }])}>
                  <Plus className="w-3 h-3 mr-1" />Add Row
                </Button>
              </div>
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-left">RM/PM Code</th>
                      <th className="p-2 text-left min-w-[180px]">RM/PM Name</th>
                      <th className="p-2 text-left">UOM</th>
                      <th className="p-2 text-right">Required QTY<br/>(incl. wastage)</th>
                      <th className="p-2 text-right">Total Amount</th>
                      <th className="p-2 text-right">Wastage %</th>
                      <th className="p-2 text-right">Wastage QTY</th>
                      <th className="p-2 text-right">Actual QTY</th>
                      <th className="p-2 text-right">Unit Price</th>
                      <th className="p-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const mat = materials.find((m) => m.id === it.material_id);
                      return (
                        <tr key={idx} className="border-t">
                          <td className="p-1 font-mono text-[11px]">{mat?.item_code || "—"}</td>
                          <td className="p-1 min-w-[200px]">
                            <ItemCombobox
                              items={materials}
                              value={it.material_id}
                              onChange={(v) => handleMaterialChange(idx, v)}
                              size="sm"
                              placeholder="Search material..."
                            />
                          </td>
                          <td className="p-1"><Input className="h-8 text-xs w-16" value={it.unit} onChange={(e) => { const n = [...items]; n[idx].unit = e.target.value; setItems(n); }} /></td>
                          <td className="p-1"><Input type="number" step="0.0001" className="h-8 text-right text-xs" value={it.required_qty} onChange={(e) => { const n = [...items]; n[idx].required_qty = Number(e.target.value); setItems(n); }} /></td>
                          <td className="p-1 text-right">{fmt(itemTotal(it), 4)}</td>
                          <td className="p-1"><Input type="number" step="0.01" className="h-8 text-right text-xs" value={it.wastage_pct} onChange={(e) => { const n = [...items]; n[idx].wastage_pct = Number(e.target.value); setItems(n); }} /></td>
                          <td className="p-1 text-right">{fmt(wastageQty(it), 4)}</td>
                          <td className="p-1 text-right">{fmt(actualQty(it), 4)}</td>
                          <td className="p-1"><Input type="number" step="0.0001" className="h-8 text-right text-xs" value={it.unit_price} onChange={(e) => { const n = [...items]; n[idx].unit_price = Number(e.target.value); setItems(n); }} /></td>
                          <td className="p-1">{items.length > 1 && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setItems(items.filter((_, i) => i !== idx))}><Trash2 className="w-3 h-3 text-destructive" /></Button>}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t font-semibold bg-muted/50">
                      <td colSpan={3} className="p-2 text-right">Total</td>
                      <td className="p-2 text-right">{fmt(items.reduce((s, i) => s + i.required_qty, 0), 4)}</td>
                      <td className="p-2 text-right">{fmt(rmTotalAmount, 4)}</td>
                      <td></td>
                      <td className="p-2 text-right">{fmt(items.reduce((s, i) => s + wastageQty(i), 0), 4)}</td>
                      <td className="p-2 text-right">{fmt(items.reduce((s, i) => s + actualQty(i), 0), 4)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Expenses */}
            <div className="col-span-4 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-base">Expenses</Label>
                <Button variant="outline" size="sm" onClick={() => setExpenses([...expenses, { account_id: "", rate: 0 }])}>
                  <Plus className="w-3 h-3 mr-1" />Add
                </Button>
              </div>
              <div className="border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-left">EXP Code</th>
                      <th className="p-2 text-left">Expenses Name</th>
                      <th className="p-2 text-right">Expenses Rate</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((ex, idx) => {
                      const acc = accounts.find((a) => a.id === ex.account_id);
                      return (
                        <tr key={idx} className="border-t">
                          <td className="p-1 font-mono text-[11px]">{acc?.account_code || "—"}</td>
                          <td className="p-1">
                            <AccountCombobox
                              accounts={accounts as any}
                              value={ex.account_id}
                              onChange={(v) => { const n = [...expenses]; n[idx].account_id = v; setExpenses(n); }}
                            />
                          </td>
                          <td className="p-1"><Input type="number" step="0.0001" className="h-8 text-right text-xs" value={ex.rate} onChange={(e) => { const n = [...expenses]; n[idx].rate = Number(e.target.value); setExpenses(n); }} /></td>
                          <td className="p-1">{expenses.length > 1 && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpenses(expenses.filter((_, i) => i !== idx))}><Trash2 className="w-3 h-3 text-destructive" /></Button>}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t font-semibold bg-muted/50">
                      <td colSpan={2} className="p-2 text-right">Total</td>
                      <td className="p-2 text-right">{fmt(expTotal, 4)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="space-y-1 pt-2">
                <Label className="text-xs">Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save BOM</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Preview / PDF Dialog ===== */}
      <Dialog open={!!previewBom} onOpenChange={(o) => !o && setPreviewBom(null)}>
        <DialogContent className="max-w-[1100px] max-h-[90vh] overflow-y-auto print:max-w-none print:shadow-none">
          <DialogHeader className="print:hidden">
            <div className="flex items-center justify-between">
              <DialogTitle>BOM Preview</DialogTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handlePreviewPdf("open")}><FileText className="w-4 h-4 mr-1" />Open PDF</Button>
                <Button size="sm" onClick={() => handlePreviewPdf("save")}><Download className="w-4 h-4 mr-1" />Download PDF</Button>
              </div>
            </div>
          </DialogHeader>
          {previewBom && (
            <div id="bom-print" className="p-4 text-sm bg-white text-black">
              <h2 className="text-lg font-bold text-center mb-4">Bill of Materials</h2>
              <table className="mb-4">
                <tbody>
                  <tr><td className="pr-3 font-semibold">Bill of Materials SL:</td><td className="border px-2 py-1 min-w-[300px]">{previewBom.bom_number || "—"}</td></tr>
                  <tr><td className="pr-3 font-semibold">Finished Product:</td><td className="border px-2 py-1">{previewBom.product?.item_name || "—"}</td></tr>
                  <tr><td className="pr-3 font-semibold">UOM:</td><td className="border px-2 py-1">{previewBom.uom?.abbreviation || previewBom.uom?.name || "—"}</td></tr>
                  <tr><td className="pr-3 font-semibold">Previous Rate:</td><td className="border px-2 py-1">{fmt(Number(previewBom.previous_rate) || 0, 4)}</td></tr>
                  <tr><td className="pr-3 font-semibold">Current Rate:</td><td className="border px-2 py-1 font-semibold">{fmt(Number(previewBom.current_rate) || 0, 4)}</td></tr>
                </tbody>
              </table>

              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-8">
                  <div className="font-semibold mb-1">RM/PM List</div>
                  <table className="w-full border text-xs">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border p-1">RM/PM Code</th>
                        <th className="border p-1">RM/PM Name</th>
                        <th className="border p-1">UOM</th>
                        <th className="border p-1">Required QTY</th>
                        <th className="border p-1">Total Amount</th>
                        <th className="border p-1">Wastage %</th>
                        <th className="border p-1">Wastage QTY</th>
                        <th className="border p-1">Actual QTY</th>
                        <th className="border p-1">Unit Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewItems.map((i: any) => (
                        <tr key={i.id}>
                          <td className="border p-1">{i.material?.item_code || "—"}</td>
                          <td className="border p-1">{i.material?.item_name || "—"}</td>
                          <td className="border p-1 text-center">{i.unit}</td>
                          <td className="border p-1 text-right">{fmt(i.required_qty)}</td>
                          <td className="border p-1 text-right">{fmt(actualQty(i) * i.unit_price)}</td>
                          <td className="border p-1 text-right">{fmt(i.wastage_pct, 2)}</td>
                          <td className="border p-1 text-right">{fmt(wastageQty(i))}</td>
                          <td className="border p-1 text-right">{fmt(actualQty(i))}</td>
                          <td className="border p-1 text-right">{fmt(i.unit_price)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold bg-gray-50">
                        <td colSpan={3} className="border p-1 text-right">Total</td>
                        <td className="border p-1 text-right">{fmt(previewItems.reduce((s, i) => s + i.required_qty, 0))}</td>
                        <td className="border p-1 text-right">{fmt(previewItems.reduce((s, i) => s + actualQty(i) * i.unit_price, 0))}</td>
                        <td className="border p-1"></td>
                        <td className="border p-1 text-right">{fmt(previewItems.reduce((s, i) => s + wastageQty(i), 0))}</td>
                        <td className="border p-1 text-right">{fmt(previewItems.reduce((s, i) => s + actualQty(i), 0))}</td>
                        <td className="border p-1"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="col-span-4">
                  <div className="font-semibold mb-1">Expenses</div>
                  <table className="w-full border text-xs">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border p-1">EXP Code</th>
                        <th className="border p-1">Expenses Name</th>
                        <th className="border p-1">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewExp.map((e: any) => (
                        <tr key={e.id}>
                          <td className="border p-1">{e.account?.account_code || "—"}</td>
                          <td className="border p-1">{e.account?.account_name || "—"}</td>
                          <td className="border p-1 text-right">{fmt(Number(e.rate) || 0)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold bg-gray-50">
                        <td colSpan={2} className="border p-1 text-right">Total</td>
                        <td className="border p-1 text-right">{fmt(previewExp.reduce((s, e: any) => s + (Number(e.rate) || 0), 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #bom-print, #bom-print * { visibility: visible; }
          #bom-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default BOMPage;
