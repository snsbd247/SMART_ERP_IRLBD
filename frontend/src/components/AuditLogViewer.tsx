import { useEffect, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { History } from "lucide-react";

interface AuditEntry {
  id: string;
  user_name: string | null;
  module: string;
  action: string;
  record_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  module: string | string[];
  recordId?: string;
  title?: string;
  actionFilter?: string[]; // e.g. ["voucher_soft_deleted","voucher_restored"]
}

const actionBadge = (action: string) => {
  if (action.includes("delete")) return "destructive";
  if (action.includes("restore")) return "default";
  if (action.includes("approve")) return "secondary";
  return "outline";
};

export function AuditLogViewer({ open, onOpenChange, module, recordId, title, actionFilter }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const moduleKey = Array.isArray(module) ? module.join(",") : module;

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const modules = Array.isArray(module) ? module : [module];
      let q = dataClient
        .from("audit_log")
        .select("id,user_name,module,action,record_id,details,ip_address,created_at")
        .in("module", modules)
        .order("created_at", { ascending: false })
        .limit(200);
      if (recordId) q = q.eq("record_id", recordId);
      if (actionFilter && actionFilter.length) q = q.in("action", actionFilter);
      const { data } = await q;
      setEntries((data || []) as AuditEntry[]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, moduleKey, recordId, actionFilter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" /> {title || "Audit Log"}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {loading ? (
            <div className="text-center text-muted-foreground py-6 text-sm">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-center text-muted-foreground py-6 text-sm">No audit entries.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">When</TableHead>
                  <TableHead className="w-40">User</TableHead>
                  <TableHead className="w-40">Action</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(e.created_at), "yyyy-MM-dd HH:mm")}
                    </TableCell>
                    <TableCell className="text-xs">{e.user_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={actionBadge(e.action) as any} className="text-xs">
                        {e.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{e.details || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
