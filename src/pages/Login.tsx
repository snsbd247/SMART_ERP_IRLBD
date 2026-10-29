import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { getEmailByUsername } from "@/lib/db-utils";
import { isLaravelMode } from "@/lib/laravel-auth";
import { useBranding } from "@/contexts/BrandingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LogIn, Building2, Eye, EyeOff, Mail, UserPlus } from "lucide-react";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";
import { useEffect as useEffectReact } from "react";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  // Laravel mode: SMS-OTP based reset — step 1 requests a code, step 2 verifies + sets new password.
  const [forgotStep, setForgotStep] = useState<"request" | "verify">("request");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [publicRegEnabled, setPublicRegEnabled] = useState(false);
  const { signIn } = useAuth();

  useEffectReact(() => {
    const base = getApiBaseUrl();
    if (!base) return;
    fetch(`${base}/v1/public/employee-registration/config`)
      .then(r => r.json())
      .then(p => setPublicRegEnabled(!!(p?.data ?? p)?.enabled))
      .catch(() => {});
  }, []);
  const { branding } = useBranding();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let loginId = username;
      if (!isLaravelMode()) {
        const email = await getEmailByUsername(username);
        if (!email) throw new Error("Username not found.");
        loginId = email;
      }

      const { error } = await signIn(loginId, password);
      if (error) throw error;
      navigate("/");
    } catch (err: any) {
      const msg = err.message || "";
      let friendly: string;
      if (msg.includes("banned") || msg.includes("disabled")) {
        friendly = "Your account has been disabled. Please contact the administrator.";
      } else if (msg.includes("Invalid login") || msg.includes("non-2xx") || msg.includes("Invalid Refresh Token")) {
        friendly = "Invalid username or password. Please try again.";
      } else if (msg.includes("not found")) {
        friendly = "Username not found. Please check and try again.";
      } else {
        friendly = msg;
      }
      toast({ title: "Login Failed", description: friendly, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isLaravelMode()) {
        const base = getApiBaseUrl();
        const res = await fetch(`${base}/auth/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getLaravelAuthHeaders() },
          body: JSON.stringify({ username: forgotEmail }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
        toast({ title: "Code Sent", description: json?.message || "If the account exists, a reset code has been sent to the registered mobile number." });
        setForgotStep("verify");
        return;
      }
      const { error } = await dataClient.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({ title: "Email Sent", description: "Check your email for a password reset link." });
      setForgotMode(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetWithOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getLaravelAuthHeaders() },
        body: JSON.stringify({
          username: forgotEmail,
          code: otpCode,
          new_password: newPassword,
          new_password_confirmation: confirmNewPassword,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
      toast({ title: "Password Reset", description: json?.message || "Password has been reset. You can now log in." });
      setForgotMode(false);
      setForgotStep("request");
      setOtpCode("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-2xl border-0 rounded-2xl">
        <CardHeader className="text-center pb-2 pt-8">
          {branding.login_logo_url ? (
            <img src={branding.login_logo_url} alt="Logo" className="h-16 mx-auto mb-3 object-contain" />
          ) : branding.company_logo_url ? (
            <img src={branding.company_logo_url} alt="Logo" className="h-16 mx-auto mb-3 object-contain" />
          ) : (
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Building2 className="w-8 h-8 text-primary" />
            </div>
          )}
          {(() => {
            const hasLogo = !!(branding.login_logo_url || branding.company_logo_url);
            const title = forgotMode
              ? "Forgot Password"
              : (hasLogo ? "" : (branding.software_name || "SmartERP"));
            if (!title) return null;
            return (
              <CardTitle className="text-2xl font-bold text-foreground">
                {title}
              </CardTitle>
            );
          })()}
          <CardDescription className="text-sm">
            {forgotMode
              ? (isLaravelMode()
                  ? (forgotStep === "request" ? "Enter your username to receive a reset code by SMS" : "Enter the code sent to your phone and choose a new password")
                  : "Enter your email to receive a reset link")
              : "Sign in to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          {forgotMode ? (
            isLaravelMode() && forgotStep === "verify" ? (
              <form onSubmit={handleResetWithOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="otpCode" className="text-xs font-medium">Reset Code</Label>
                  <Input id="otpCode" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="6-digit code" required maxLength={6} className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword" className="text-xs font-medium">New Password</Label>
                  <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" required minLength={8} className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmNewPassword" className="text-xs font-medium">Confirm New Password</Label>
                  <Input id="confirmNewPassword" type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder="••••••••" required minLength={8} className="h-10" />
                </div>
                <Button type="submit" className="w-full h-10" disabled={submitting}>
                  {submitting ? "Resetting..." : "Reset Password"}
                </Button>
                <div className="text-center">
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setForgotStep("request")}>
                    Didn't get a code? Try again
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="forgotEmail" className="text-xs font-medium">{isLaravelMode() ? "Username" : "Email Address"}</Label>
                  <Input id="forgotEmail" type={isLaravelMode() ? "text" : "email"} value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder={isLaravelMode() ? "Enter your username" : "user@company.com"} required className="h-10" />
                </div>
                <Button type="submit" className="w-full h-10" disabled={submitting}>
                  {submitting ? "Sending..." : <><Mail className="w-4 h-4 mr-2" />{isLaravelMode() ? "Send Reset Code" : "Send Reset Link"}</>}
                </Button>
                <div className="text-center">
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setForgotMode(false); setForgotStep("request"); }}>
                    Back to login
                  </button>
                </div>
              </form>
            )
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-xs font-medium">Username</Label>
                  <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter your username" required className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-medium">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="h-10 pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full h-10" disabled={submitting}>
                  {submitting ? "Please wait..." : <><LogIn className="w-4 h-4 mr-2" />Sign In</>}
                </Button>
              </form>
              <div className="mt-4 flex items-center justify-between">
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setForgotMode(true)}>
                  Forgot password?
                </button>
                <a href="/employee/verify" className="text-xs text-primary hover:underline">
                  Verify Employee
                </a>
              </div>
              {publicRegEnabled && (
                <div className="mt-3 text-center border-t border-border pt-3">
                  <a href="/register-employee" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    <UserPlus className="w-3 h-3" /> New employee? Register here
                  </a>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
