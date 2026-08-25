import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck, ShieldAlert, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLicense } from "@/contexts/LicenseContext";

const LicenseVerificationPage = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { loading, blocked, status, message, expiresAt, activate } = useLicense();
  const [key, setKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      } else {
        toast.error(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const valid = !loading && !blocked;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
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
            <div className="text-xs text-muted-foreground text-center uppercase tracking-wide">
              Status: {status}
              {expiresAt ? ` · Expires: ${new Date(expiresAt).toLocaleDateString()}` : ""}
            </div>
          )}
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
    </div>
  );
};

export default LicenseVerificationPage;
