import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  APACHE_LIMIT_REQUEST_LINE,
  DEFAULT_IN_CHUNK_SIZE,
  getInChunkSize,
  estimateInClauseUrlLength,
} from "@/lib/in-chunk";

const LS_KEY = "in_chunk_size_override";

function applyOverride(size: number | null) {
  const w: any = window;
  if (size && size > 0) w.__IN_CHUNK_SIZE__ = size;
  else delete w.__IN_CHUNK_SIZE__;
}

export default function InChunkSettingsPage() {
  const [value, setValue] = useState<string>("");
  const [active, setActive] = useState<number>(DEFAULT_IN_CHUNK_SIZE);

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n) && n > 0) {
        applyOverride(n);
        setValue(String(n));
      }
    }
    setActive(getInChunkSize());
  }, []);

  const preview = () => {
    const size = Number(value) || getInChunkSize();
    const sampleIds = Array.from({ length: size }, () => "00000000-0000-0000-0000-000000000000");
    const base = "/api/v1/db/voucher_entries?select=account_id,debit,credit&f[voucher_id][in]=";
    return {
      size,
      urlBytes: estimateInClauseUrlLength(base, sampleIds),
      overLimit: estimateInClauseUrlLength(base, sampleIds) > APACHE_LIMIT_REQUEST_LINE,
    };
  };

  const save = () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a positive number");
      return;
    }
    applyOverride(n);
    localStorage.setItem(LS_KEY, String(n));
    setActive(getInChunkSize());
    toast.success(`IN chunk size set to ${n} for this environment`);
  };

  const reset = () => {
    applyOverride(null);
    localStorage.removeItem(LS_KEY);
    setValue("");
    setActive(getInChunkSize());
    toast.success("Reverted to default / env value");
  };

  const p = preview();

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Query Batch (IN chunk) Size</CardTitle>
          <CardDescription>
            Controls how many IDs are packed into a single <code>IN (...)</code> clause. Lower
            values are safer under Apache's <code>LimitRequestLine</code> (default {APACHE_LIMIT_REQUEST_LINE} bytes);
            higher values reduce round-trips. Override applies to this browser/environment only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div>Active value: <b>{active}</b></div>
            <div>Default: {DEFAULT_IN_CHUNK_SIZE} · Env: <code>VITE_IN_CHUNK_SIZE</code></div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chunk">Override</Label>
            <div className="flex gap-2">
              <Input
                id="chunk"
                type="number"
                min={1}
                placeholder={String(DEFAULT_IN_CHUNK_SIZE)}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <Button onClick={save}>Save</Button>
              <Button variant="outline" onClick={reset}>Reset</Button>
            </div>
          </div>

          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="font-medium">Live preview</div>
            <div>Chunk size: {p.size}</div>
            <div>
              Estimated URL: <b>{p.urlBytes.toLocaleString()} bytes</b>{" "}
              <span className={p.overLimit ? "text-destructive" : "text-emerald-600"}>
                ({p.overLimit ? "OVER" : "within"} {APACHE_LIMIT_REQUEST_LINE}-byte limit)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
