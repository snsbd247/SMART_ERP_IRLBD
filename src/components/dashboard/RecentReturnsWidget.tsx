import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Undo2, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Entry {
  id: string;
  user_name: string | null;
  action: string;
  module: string;
  record_id: string | null;
  details: string | null;
  created_at: string;
}

/**
 * Consolidated audit widget showing recent Return actions (purchase + sales),
 * with quick links to the related Returns page.
 */
export function RecentReturnsWidget() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("id,user_name,action,module,record_id,details,created_at")
        .in("module", ["purchase_returns", "sales_returns"])
        .order("created_at", { ascending: false })
        .limit(8);
      setRows((data as Entry[]) || []);
      setLoading(false);
    })();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2 px-3 sm:px-6">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-2">
            <Undo2 className="w-3.5 h-3.5 text-orange-500" /> Recent Return Activity
          </CardTitle>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => navigate("/purchase-workflow/returns")}>
              Purchase <ExternalLink className="w-3 h-3 ml-1" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => navigate("/sales-workflow/returns")}>
              Sales <ExternalLink className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
        {loading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No recent return actions</p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-auto">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                <Badge
                  variant={r.action.includes("approve") ? "default" : r.action.includes("delete") ? "destructive" : "secondary"}
                  className="text-[10px] shrink-0"
                >
                  {r.action}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate">
                    <span className="font-medium">{r.user_name || "System"}</span>{" "}
                    <span className="text-muted-foreground">·</span>{" "}
                    {r.module === "purchase_returns" ? "Purchase Return" : "Sales Return"}
                    {r.details ? <span className="text-muted-foreground"> — {r.details}</span> : null}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
