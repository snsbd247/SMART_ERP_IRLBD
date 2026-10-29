import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dataClient } from "@/integrations/data/client";
import { toast } from "sonner";
import {
  IFRSLine, IFRS_LINE_LABEL, defaultMapping, normalizeIFRSLine,
  PL_SECTIONS, BS_SECTIONS,
} from "@/lib/ifrs-mapping";
import { Loader2, Save, RotateCcw, Settings2 } from "lucide-react";

type Account = {
  id: string; account_name: string; account_code: string; account_type: string;
};

const ALL_LINES: IFRSLine[] = [
  ...BS_SECTIONS.non_current_assets, ...BS_SECTIONS.current_assets,
  ...BS_SECTIONS.equity,
  ...BS_SECTIONS.non_current_liabilities, ...BS_SECTIONS.current_liabilities,
  ...PL_SECTIONS.revenue, ...PL_SECTIONS.cogs, ...PL_SECTIONS.op_expense,
  ...PL_SECTIONS.other_income, ...PL_SECTIONS.tax,
];

const IFRSMappingPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [overrides, setOverrides] = useState<Map<string, IFRSLine>>(new Map());
  const [pending, setPending] = useState<Map<string, IFRSLine | "__default__">>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [normalizing, setNormalizing] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const [a, m] = await Promise.all([
      dataClient.from("chart_of_accounts").select("id, account_name, account_code, account_type").order("account_code"),
      dataClient.from("ifrs_account_mapping" as any).select("account_id, ifrs_line"),
    ]);
    setAccounts((a.data || []) as Account[]);
    const om = new Map<string, IFRSLine>();
    (m.data as any[] || []).forEach(r => {
      const normalized = normalizeIFRSLine(r.ifrs_line);
      if (normalized) om.set(r.account_id, normalized);
    });
    setOverrides(om);
    setPending(new Map());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return accounts.filter(a =>
      (typeFilter === "all" || a.account_type === typeFilter) &&
      (!s || a.account_name.toLowerCase().includes(s) || a.account_code.toLowerCase().includes(s))
    );
  }, [accounts, search, typeFilter]);

  const setPick = (id: string, val: IFRSLine | "__default__") => {
    const next = new Map(pending);
    next.set(id, val);
    setPending(next);
  };

  const effectiveLine = (a: Account): { line: IFRSLine; source: "default" | "override" | "pending" } => {
    if (pending.has(a.id)) {
      const v = pending.get(a.id)!;
      if (v === "__default__") return { line: defaultMapping(a.account_name, a.account_type, a.account_code), source: "pending" };
      return { line: v, source: "pending" };
    }
    if (overrides.has(a.id)) return { line: overrides.get(a.id)!, source: "override" };
    return { line: defaultMapping(a.account_name, a.account_type, a.account_code), source: "default" };
  };

  const save = async () => {
    if (pending.size === 0) { toast.info("No changes to save"); return; }
    setSaving(true);
    const upserts: { account_id: string; ifrs_line: IFRSLine }[] = [];
    const deletes: string[] = [];
    pending.forEach((val, id) => {
      if (val === "__default__") deletes.push(id);
      else upserts.push({ account_id: id, ifrs_line: val });
    });

    try {
      if (deletes.length > 0) {
        const { error } = await dataClient.from("ifrs_account_mapping" as any).delete().in("account_id", deletes);
        if (error) throw error;
      }
      if (upserts.length > 0) {
        const { error } = await dataClient.from("ifrs_account_mapping" as any).upsert(upserts as any, { onConflict: "account_id" });
        if (error) throw error;
      }
      toast.success(`Saved ${pending.size} change${pending.size > 1 ? "s" : ""}`);
      await load();
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const normalizeAllMappings = async () => {
    setNormalizing(true);
    try {
      const rows = accounts.map(a => ({
        account_id: a.id,
        ifrs_line: effectiveLine(a).line,
        notes: overrides.has(a.id) ? "normalized" : "auto-mapped",
      }));
      const { error } = await dataClient
        .from("ifrs_account_mapping" as any)
        .upsert(rows as any, { onConflict: "account_id" });
      if (error) throw error;
      toast.success(`Mapped ${rows.length} IFRS accounts`);
      await load();
    } catch (e: any) {
      toast.error("Normalize failed: " + (e?.message || "Unknown error"));
    } finally {
      setNormalizing(false);
    }
  };

  const resetPending = () => setPending(new Map());

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-2">
        <Settings2 className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">IFRS Account Mapping</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Override the IFRS Financial Statement line item for each account. If no override is set, the default rule applies.
      </p>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Search</Label>
            <Input placeholder="Name or code..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="min-w-[160px]">
            <Label className="text-xs">Account Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="asset">Asset</SelectItem>
                <SelectItem value="liability">Liability</SelectItem>
                <SelectItem value="equity">Equity</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetPending} disabled={pending.size === 0}>
              <RotateCcw className="w-4 h-4 mr-1" /> Discard
            </Button>
            <Button variant="outline" onClick={normalizeAllMappings} disabled={loading || normalizing || accounts.length === 0}>
              {normalizing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Settings2 className="w-4 h-4 mr-1" />}
              Map All
            </Button>
            <Button onClick={save} disabled={saving || pending.size === 0}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Save {pending.size > 0 && `(${pending.size})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead className="w-72">IFRS Line</TableHead>
                  <TableHead className="w-24">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      No accounts found
                    </TableCell>
                  </TableRow>
                ) : filtered.map(a => {
                  const eff = effectiveLine(a);
                  const currentValue = pending.has(a.id)
                    ? pending.get(a.id)!
                    : overrides.has(a.id) ? overrides.get(a.id)! : "__default__";
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.account_code}</TableCell>
                      <TableCell className="text-sm">{a.account_name}</TableCell>
                      <TableCell className="text-xs capitalize">{a.account_type}</TableCell>
                      <TableCell>
                        <Select value={currentValue} onValueChange={(v) => setPick(a.id, v as any)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">
                              Default → {IFRS_LINE_LABEL[defaultMapping(a.account_name, a.account_type, a.account_code)]}
                            </SelectItem>
                            {ALL_LINES.map(l => (
                              <SelectItem key={l} value={l}>{IFRS_LINE_LABEL[l]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          eff.source === "pending" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :
                          eff.source === "override" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {eff.source}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default IFRSMappingPage;
