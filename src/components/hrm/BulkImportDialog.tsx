import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Download, FileText, AlertCircle, CheckCircle2 } from "lucide-react";

export interface BulkColumn {
  key: string;
  label: string;
  required?: boolean;
  example?: string;
}

export interface BulkImportConfig {
  title: string;
  table: string;
  templateFilename: string;
  columns: BulkColumn[];
  /** Transforms a parsed CSV row (label -> string) into a DB payload. Throw Error to reject the row. */
  transform: (row: Record<string, string>) => Record<string, any>;
  /** Optional row-level uniqueness key to skip duplicates in the same file. */
  dedupeKey?: (row: Record<string, string>) => string;
  onSuccess?: () => void;
  helpText?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: BulkImportConfig;
}

interface ParsedRow {
  rowNum: number;
  raw: Record<string, string>;
  payload?: Record<string, any>;
  error?: string;
}

const MAX_ROWS = 5000;
const CHUNK = 50;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(v => v.trim() !== ""));
}

function toCsv(rows: string[][]): string {
  return rows.map(r => r.map(v => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(",")).join("\n");
}

export function BulkImportDialog({ open, onOpenChange, config }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const cancelRef = useRef(false);
  const [result, setResult] = useState<{ ok: number; fail: number; errors: ParsedRow[]; cancelled?: boolean } | null>(null);

  const reset = () => { setParsed([]); setResult(null); setProgress(0); setProcessed(0); setTotal(0); cancelRef.current = false; if (inputRef.current) inputRef.current.value = ""; };

  const downloadTemplate = () => {
    const headers = config.columns.map(c => c.label + (c.required ? " *" : ""));
    const example = config.columns.map(c => c.example ?? "");
    const csv = toCsv([headers, example]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = config.templateFilename; a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File) => {
    reset();
    const text = await file.text();
    const grid = parseCsv(text);
    if (grid.length < 2) { toast.error("Empty CSV or missing data rows"); return; }
    const rawHeaders = grid[0].map(h => h.trim().replace(/\s*\*$/, ""));
    const labelToKey: Record<string, string> = {};
    config.columns.forEach(c => { labelToKey[c.label.toLowerCase()] = c.key; });

    const dataRows = grid.slice(1);
    if (dataRows.length > MAX_ROWS) { toast.error(`Max ${MAX_ROWS} rows per import`); return; }

    const seen = new Set<string>();
    const out: ParsedRow[] = [];
    dataRows.forEach((cols, idx) => {
      const rowNum = idx + 2;
      const raw: Record<string, string> = {};
      rawHeaders.forEach((h, i) => {
        const key = labelToKey[h.toLowerCase()];
        if (key) raw[key] = (cols[i] ?? "").trim();
        raw[h] = (cols[i] ?? "").trim();
      });
      const row: ParsedRow = { rowNum, raw };
      try {
        if (config.dedupeKey) {
          const k = config.dedupeKey(raw);
          if (k && seen.has(k)) throw new Error(`Duplicate in file: ${k}`);
          if (k) seen.add(k);
        }
        for (const c of config.columns) {
          if (c.required && !raw[c.key]) throw new Error(`${c.label} is required`);
        }
        row.payload = config.transform(raw);
      } catch (e: any) {
        row.error = e.message || "Invalid row";
      }
      out.push(row);
    });
    setParsed(out);
  };

  const runImport = async () => {
    const valid = parsed.filter(r => r.payload && !r.error);
    if (!valid.length) { toast.error("No valid rows"); return; }
    setImporting(true); setProgress(0); setProcessed(0); setTotal(valid.length); cancelRef.current = false;
    const errors: ParsedRow[] = parsed.filter(r => r.error);
    let ok = 0;
    let cancelled = false;

    for (let i = 0; i < valid.length; i += CHUNK) {
      if (cancelRef.current) { cancelled = true; break; }
      const chunk = valid.slice(i, i + CHUNK);
      const { error } = await supabase.from(config.table as any).insert(chunk.map(r => r.payload));
      if (error) {
        for (const r of chunk) {
          if (cancelRef.current) { cancelled = true; break; }
          const { error: e2 } = await supabase.from(config.table as any).insert(r.payload as any);
          if (e2) errors.push({ ...r, error: e2.message }); else ok++;
        }
      } else {
        ok += chunk.length;
      }
      const done = Math.min(i + chunk.length, valid.length);
      setProcessed(done);
      setProgress(Math.round((done / valid.length) * 100));
    }

    setResult({ ok, fail: errors.length, errors, cancelled });
    setImporting(false);
    if (cancelled) toast.warning(`Import cancelled. ${ok} imported before stop.`);
    else if (ok) toast.success(`Imported ${ok} row${ok > 1 ? "s" : ""}`);
    if (errors.length) toast.error(`${errors.length} row${errors.length > 1 ? "s" : ""} failed`);
    if (ok && config.onSuccess) config.onSuccess();
  };

  const downloadErrors = () => {
    if (!result?.errors.length) return;
    const headers = [...config.columns.map(c => c.label), "Row #", "Error"];
    const rows = result.errors.map(r => [
      ...config.columns.map(c => r.raw[c.key] ?? ""),
      String(r.rowNum),
      r.error ?? "",
    ]);
    const blob = new Blob([toCsv([headers, ...rows])], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `errors_${config.templateFilename}`; a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = parsed.filter(r => !r.error).length;
  const errorCount = parsed.length - validCount;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!importing) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="w-5 h-5" />{config.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded border bg-muted/30 p-3 text-sm space-y-2">
            <div className="flex items-center gap-2 font-medium"><FileText className="w-4 h-4" />Required columns</div>
            <div className="flex flex-wrap gap-1">
              {config.columns.map(c => (
                <Badge key={c.key} variant={c.required ? "default" : "secondary"}>{c.label}{c.required && " *"}</Badge>
              ))}
            </div>
            {config.helpText && <p className="text-muted-foreground text-xs">{config.helpText}</p>}
            <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="w-4 h-4 mr-2" />Download Template</Button>
          </div>

          <div>
            <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-primary file:text-primary-foreground hover:file:bg-primary/90" />
            <p className="text-xs text-muted-foreground mt-1">Max {MAX_ROWS} rows. UTF-8 CSV.</p>
          </div>

          {parsed.length > 0 && !result && (
            <>
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="default" className="gap-1"><CheckCircle2 className="w-3 h-3" />{validCount} valid</Badge>
                {errorCount > 0 && <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" />{errorCount} invalid</Badge>}
              </div>
              <div className="max-h-64 overflow-auto border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Row</TableHead>
                      {config.columns.slice(0, 4).map(c => <TableHead key={c.key}>{c.label}</TableHead>)}
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.slice(0, 100).map(r => (
                      <TableRow key={r.rowNum} className={r.error ? "bg-destructive/10" : ""}>
                        <TableCell className="font-mono">{r.rowNum}</TableCell>
                        {config.columns.slice(0, 4).map(c => <TableCell key={c.key} className="text-xs">{r.raw[c.key] || "-"}</TableCell>)}
                        <TableCell className="text-xs">{r.error ? <span className="text-destructive">{r.error}</span> : <span className="text-green-600">OK</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {importing && (
            <div className="space-y-2" data-testid="bulk-import-progress">
              <Progress value={progress} />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Importing {processed} / {total} ({progress}%)</span>
                <Button size="sm" variant="ghost" onClick={() => { cancelRef.current = true; }} data-testid="bulk-import-cancel">Cancel</Button>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded border p-3">
              <div className="flex gap-3">
                <Badge variant="default">{result.ok} imported</Badge>
                {result.fail > 0 && <Badge variant="destructive">{result.fail} failed</Badge>}
              </div>
              {result.fail > 0 && <Button size="sm" variant="outline" onClick={downloadErrors}><Download className="w-4 h-4 mr-2" />Download Errors CSV</Button>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>Close</Button>
          {parsed.length > 0 && !result && <Button onClick={runImport} disabled={importing || validCount === 0}>Import {validCount} row{validCount > 1 ? "s" : ""}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
