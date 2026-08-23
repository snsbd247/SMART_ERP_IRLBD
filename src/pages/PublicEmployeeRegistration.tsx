import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBaseUrl } from "@/lib/laravel-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, CheckCircle2, Building2 } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
interface Option { id: string; name: string; }
interface Config {
  enabled: boolean;
  company_name: string;
  company_logo_url: string | null;
  next_employee_code?: string | null;
  branches: Option[];
  departments: Option[];
  designations: Option[];
}

const empty = {
  first_name: "", last_name: "", email: "", mobile: "", national_id: "",
  address: "", department_id: "", designation_id: "", branch_id: "",
  joining_date: new Date().toISOString().split("T")[0],
  password: "", password_confirm: "",
};

export default function PublicEmployeeRegistration() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(empty);
  const [done, setDone] = useState<{ code: string; username?: string } | null>(null);

  useEffect(() => {
    const loadFromSupabase = async () => {
      try {
        const { data: cs } = await supabase
          .from("company_settings" as any)
          .select("company_name, company_logo_url, public_employee_registration_enabled")
          .maybeSingle();
        const row: any = cs || {};
        setConfig({
          enabled: !!row.public_employee_registration_enabled,
          company_name: row.company_name || "Company",
          company_logo_url: row.company_logo_url || null,
          branches: [],
          departments: [],
          designations: [],
        });
      } catch {
        setConfig(null);
      } finally {
        setLoading(false);
      }
    };

    const base = getApiBaseUrl();
    if (!base) { loadFromSupabase(); return; }
    fetch(`${base}/v1/public/employee-registration/config`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(p => { setConfig((p?.data ?? p) as Config); setLoading(false); })
      .catch(() => loadFromSupabase());
  }, []);

  const validatePassword = (pw: string): string | null => {
    if (pw.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Za-z]/.test(pw)) return "Password must contain at least one letter.";
    if (!/\d/.test(pw)) return "Password must contain at least one number.";
    if (/^(.)\1+$/.test(pw)) return "Password cannot be a single repeated character.";
    const isSeq = (s: string, step: 1 | -1) => {
      for (let i = 1; i < s.length; i++) if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false;
      return true;
    };
    const lower = pw.toLowerCase();
    if (isSeq(lower, 1) || isSeq(lower, -1)) return "Password cannot be a simple sequence like 12345678.";
    const banned = ["password", "password1", "password123", "qwerty123", "12345678", "123456789", "1234567890", "abcdefgh"];
    if (banned.includes(lower)) return "This password is too common. Choose a stronger one.";
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.joining_date) {
      toast({ title: "Missing fields", description: "First name, last name and joining date are required.", variant: "destructive" });
      return;
    }
    if (form.password || form.password_confirm) {
      const err = validatePassword(form.password);
      if (err) { toast({ title: "Weak password", description: err, variant: "destructive" }); return; }
      if (form.password !== form.password_confirm) {
        toast({ title: "Passwords don't match", description: "Please re-enter the same password.", variant: "destructive" });
        return;
      }
    }
    setSubmitting(true);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/public/employee-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...form,
          email: form.email || null,
          mobile: form.mobile || null,
          national_id: form.national_id || null,
          address: form.address || null,
          department_id: form.department_id || null,
          designation_id: form.designation_id || null,
          branch_id: form.branch_id || null,
          password: form.password || null,
          password_confirmation: form.password ? form.password_confirm : null,
          password_confirm: undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
      const data = payload?.data ?? payload;
      setDone({ code: data?.employee_code || "", username: data?.username_preview });
    } catch (err: any) {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!config?.enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-primary/90 to-primary/80 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Registration Unavailable</CardTitle>
            <CardDescription>Public employee registration is currently disabled. Please contact your administrator.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate("/login")}>Back to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-primary/90 to-primary/80 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-2">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <CardTitle>Application Submitted</CardTitle>
            <CardDescription>
              Your registration has been received and is pending administrator approval.
              {done.code && <><br /><span className="font-mono text-foreground">Employee Code: {done.code}</span></>}
              {done.username && <><br /><span className="font-mono text-foreground">Login Username: {done.username}</span><br /><span className="text-xs">After approval, your login info will be sent to your mobile number.</span></>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/login")}>Back to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary via-primary/90 to-primary/80 p-4 py-10">
      <Card className="w-full max-w-2xl mx-auto shadow-2xl border-0 rounded-2xl">
        <CardHeader className="text-center">
          {config.company_logo_url ? (
            <img src={config.company_logo_url} alt="Logo" className="h-14 mx-auto mb-2 object-contain" />
          ) : (
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-2">
              <Building2 className="w-7 h-7 text-primary" />
            </div>
          )}
          <CardTitle className="text-2xl">Employee Registration</CardTitle>
          <CardDescription>{config.company_name} — submit your details for administrator approval</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>First Name *</Label><Input value={form.first_name} onChange={e => set("first_name", e.target.value)} required /></div>
            <div><Label>Last Name *</Label><Input value={form.last_name} onChange={e => set("last_name", e.target.value)} required /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></div>
            <div><Label>Mobile</Label><Input value={form.mobile} onChange={e => set("mobile", e.target.value)} /></div>
            <div><Label>National ID</Label><Input value={form.national_id} onChange={e => set("national_id", e.target.value)} /></div>
            <div><Label>Joining Date *</Label><DateInput value={form.joining_date} onChange={(v) => set("joining_date", v)} required /></div>
            <div>
              <Label>Branch</Label>
              <Select value={form.branch_id} onValueChange={v => set("branch_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{config.branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={form.department_id} onValueChange={v => set("department_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{config.departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Designation</Label>
              <Select value={form.designation_id} onValueChange={v => set("designation_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{config.designations.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Address</Label><Input value={form.address} onChange={e => set("address", e.target.value)} /></div>

            <div className="md:col-span-2 mt-2 p-3 rounded-lg border border-dashed bg-muted/30">
              <div className="text-sm font-medium mb-2">Employee Login Account (optional)</div>
              <p className="text-xs text-muted-foreground mb-3">
                Set a password to request a login account. Your username will be auto-generated from your Employee ID
                {config.next_employee_code ? <> (e.g. <span className="font-mono">{config.next_employee_code}</span>)</> : null}.
                You'll receive login info by SMS after admin approval. Password must be at least 8 characters with letters and numbers — avoid sequences like <span className="font-mono">123456789</span>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>Password</Label><Input type="password" autoComplete="new-password" value={form.password} onChange={e => set("password", e.target.value)} minLength={8} placeholder="Min 8 chars, letters + numbers" /></div>
                <div><Label>Confirm Password</Label><Input type="password" autoComplete="new-password" value={form.password_confirm} onChange={e => set("password_confirm", e.target.value)} minLength={8} /></div>
              </div>
            </div>

            <div className="md:col-span-2 flex items-center justify-between pt-2">
              <button type="button" className="text-sm text-primary hover:underline" onClick={() => navigate("/login")}>Back to Login</button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Submit Application
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
