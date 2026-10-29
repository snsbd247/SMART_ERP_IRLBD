import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck, ShieldAlert, ArrowLeft, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLicense } from "@/contexts/LicenseContext";
import { AppSidebar } from "@/components/AppSidebar";
import { TopNavbar } from "@/components/TopNavbar";

const LicenseVerificationPage = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { loading, blocked, status, message, expiresAt, activatedAt, lastCheckedAt, activate, recheck } = useLicense();
  const [key, setKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const navigate = useNavigate();

  if (!authLoading && !user) return <Navigate to="/login" replace />;

  const handleSubmit = async () => {
    if (!key.trim()) {
      toast.error("Enter a license key.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await activate(key.trim());
      if (result.ok) {
        toast.success(result.message);
        setKey("");
        navigate("/", { replace: true });
      } else {
        toast.error(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      const result = await recheck();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } finally {
      setRechecking(false);
    }
  };

  const valid = !loading && !blocked;
  const daysLeft = expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : null;

  return (
    <div className="flex h-screen bg-background w-full overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />
        <main className="flex-1 overflow-auto overscroll-contain flex items-center justify-center p-6">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center space-y-2">
              <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${valid ? "bg-success/10" : "bg-destructive/10"}`}>
                {valid ? <ShieldCheck className="w-7 h-7 text-success" /> : <ShieldAlert className="w-7 h-7 text-destructive" />}
              </div>
              <CardTitle>{valid ? "License" : "License Verification Required"}</CardTitle>
              <CardDescription>
                {loading ? "Checking license status…" : message || (valid ? "This installation's license is valid." : "This software's license could not be verified.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {status && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-medium text-foreground uppercase tracking-wide">{status}</span>
                  </div>
                  {activatedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Activated on</span>
                      <span className="font-medium text-foreground">{new Date(activatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
                    </div>
                  )}
                  {expiresAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Expires on</span>
                      <span className="font-medium text-foreground">{new Date(expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
                    </div>
                  )}
                  {daysLeft !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Days remaining</span>
                      <span className={`font-medium ${daysLeft <= 3 ? "text-destructive" : "text-foreground"}`}>
                        {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "Expired"}
                      </span>
                    </div>
                  )}
                  {lastCheckedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Last checked</span>
                      <span className="font-medium text-foreground">{new Date(lastCheckedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                  )}
                </div>
              )}
              <Button variant="outline" className="w-full" onClick={handleRecheck} disabled={rechecking || loading}>
                {rechecking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {rechecking ? "Checking..." : "Recheck license now"}
              </Button>
              <div className="space-y-2">
                <Label htmlFor="license-key">{valid ? "Activate a different license key" : "License Key"}</Label>
                <Input
                  id="license-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Enter your license key"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  autoFocus={!valid}
                />
              </div>
              <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
                Activate License
              </Button>
              {valid ? (
                <Button variant="ghost" className="w-full" asChild>
                  <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back to Dashboard</Link>
                </Button>
              ) : (
                user && (
                  <Button variant="ghost" className="w-full" onClick={() => signOut()}>
                    Sign out
                  </Button>
                )
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default LicenseVerificationPage;
