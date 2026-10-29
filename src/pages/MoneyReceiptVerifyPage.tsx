import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getApiBaseUrl } from "@/lib/laravel-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Shield, ArrowLeft, Receipt } from "lucide-react";

interface VerifyResult {
  receipt_no: string;
  receipt_date: string;
  received_from: string;
  address: string | null;
  on_account_of: string | null;
  payment_mode: string;
  payment_ref_no: string | null;
  against_bill_no: string | null;
  against_bill_date: string | null;
  amount: number;
  amount_in_words: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  company_address: string | null;
}

const PAYMENT_MODE_LABEL: Record<string, string> = { cash: "Cash", cheque: "Cheque No.", po: "P.O", dd: "D.D." };

function formatDate(d: string): string {
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MoneyReceiptVerifyPage() {
  const { code } = useParams<{ code: string }>();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      if (!code) { setLoading(false); setNotFound(true); return; }
      try {
        const base = getApiBaseUrl() || "";
        const res = await fetch(`${base}/v1/public/money-receipt-verify/${encodeURIComponent(code)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          setNotFound(true);
        } else {
          setResult(json.data);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted/50 to-background flex flex-col items-center justify-start p-4 pt-8 sm:pt-16">
      <div className="w-full max-w-md mb-6">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Login
        </Link>
      </div>

      {loading && (
        <div className="text-center py-12">
          <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Verifying receipt...</p>
        </div>
      )}

      {!loading && notFound && (
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-6 text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 mx-auto mb-4 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">Receipt Not Found</h2>
            <p className="text-sm text-muted-foreground">
              This QR code does not match any Money Receipt on record. It may be invalid or the receipt may have been deleted.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && result && (
        <div className="w-full max-w-md">
          <Card className="overflow-hidden shadow-lg">
            <div className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 text-center">
              {result.company_logo_url && <img src={result.company_logo_url} alt="Logo" className="h-8 mx-auto mb-2" />}
              <h2 className="text-base font-bold tracking-wide">{result.company_name || "Money Receipt"}</h2>
              <div className="flex items-center justify-center gap-1.5 mt-1.5">
                <Shield className="w-3 h-3" />
                <p className="text-[10px] uppercase tracking-[0.2em] opacity-80">Money Receipt Verification</p>
              </div>
            </div>

            <CardContent className="pt-5 pb-6">
              <div className="flex items-center justify-center mb-5">
                <Badge className="px-4 py-1.5 text-sm font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                  <CheckCircle className="w-4 h-4 mr-1.5" />Verified — Genuine Receipt
                </Badge>
              </div>

              <div className="text-center mb-5">
                <Receipt className="w-10 h-10 mx-auto text-primary mb-2" />
                <h3 className="text-2xl font-bold text-foreground font-mono">No. {result.receipt_no}</h3>
              </div>

              <div className="space-y-2.5 border-t border-b py-4">
                <div className="flex justify-between items-center px-1">
                  <span className="text-muted-foreground text-sm">Received From</span>
                  <span className="font-medium text-foreground text-right">{result.received_from}</span>
                </div>
                <div className="flex justify-between items-center px-1">
                  <span className="text-muted-foreground text-sm">Date</span>
                  <span className="font-medium text-foreground">{formatDate(result.receipt_date)}</span>
                </div>
                {result.address && (
                  <div className="flex justify-between items-start px-1 gap-3">
                    <span className="text-muted-foreground text-sm shrink-0">Address</span>
                    <span className="font-medium text-foreground text-right">{result.address}</span>
                  </div>
                )}
                {result.on_account_of && (
                  <div className="flex justify-between items-center px-1">
                    <span className="text-muted-foreground text-sm">On Account Of</span>
                    <span className="font-medium text-foreground text-right">{result.on_account_of}</span>
                  </div>
                )}
                <div className="flex justify-between items-center px-1">
                  <span className="text-muted-foreground text-sm">Payment Mode</span>
                  <span className="font-medium text-foreground text-right">
                    {PAYMENT_MODE_LABEL[result.payment_mode] || result.payment_mode}
                    {result.payment_ref_no ? ` — ${result.payment_ref_no}` : ""}
                  </span>
                </div>
                {result.against_bill_no && (
                  <div className="flex justify-between items-center px-1">
                    <span className="text-muted-foreground text-sm">Against Bill No</span>
                    <span className="font-medium text-foreground text-right">
                      {result.against_bill_no}
                      {result.against_bill_date ? ` (${formatDate(result.against_bill_date)})` : ""}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center px-1">
                  <span className="text-muted-foreground text-sm">Amount</span>
                  <span className="font-bold text-foreground text-lg tabular-nums">Tk. {Number(result.amount).toFixed(2)}</span>
                </div>
                {result.amount_in_words && (
                  <div className="px-1">
                    <span className="text-muted-foreground text-sm">In Words: </span>
                    <span className="font-medium text-foreground">{result.amount_in_words}</span>
                  </div>
                )}
              </div>

              <p className="text-[10px] text-center text-muted-foreground mt-4">
                Official verification from {result.company_name || "the company"}. Verified on {new Date().toLocaleDateString()}.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
