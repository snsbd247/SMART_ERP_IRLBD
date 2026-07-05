import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalEmployee } from "@/hooks/usePortalEmployee";
import { PortalEmployeeSelector } from "@/components/portal/PortalEmployeeSelector";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isLaravelMode, getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";
import { Calendar, CheckCircle2, XCircle, AlertCircle, CalendarDays, MapPin, LogIn, LogOut, RefreshCw } from "lucide-react";

async function callPortalApi(path: string, init: RequestInit = {}) {
  const base = getApiBaseUrl();
  if (!base) throw new Error("Laravel API not configured");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...getLaravelAuthHeaders(true), ...(init.headers as any) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.message || `HTTP ${res.status}`);
  return json;
}

export default function MyAttendancePage() {
  const { employee, loading, isHrAdmin, allEmployees, selectedEmployeeId, selectEmployee } = usePortalEmployee();
  const [attendance, setAttendance] = useState<any[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [today, setToday] = useState<any>(null);
  const [branchGeo, setBranchGeo] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();
  const laravel = isLaravelMode();

  useEffect(() => {
    if (!employee) return;
    const startDate = `${month}-01`;
    const endDate = new Date(Number(month.split("-")[0]), Number(month.split("-")[1]), 0).toISOString().split("T")[0];
    (async () => {
      const { data } = await supabase.from("attendance").select("*")
        .eq("employee_id", employee.id).gte("date", startDate).lte("date", endDate).order("date");
      if (data) setAttendance(data as any);
    })();
  }, [employee, month]);

  const loadToday = useCallback(async () => {
    if (!laravel) return;
    try {
      const res = await callPortalApi("/api/v1/portal/attendance/today");
      setToday(res.data);
      setBranchGeo(res.branch);
    } catch { /* ignore */ }
  }, [laravel]);

  useEffect(() => { loadToday(); }, [loadToday]);

  const [geoError, setGeoError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<"check_in" | "check_out" | null>(null);

  const logGeoPermission = useCallback(
    async (status: "granted" | "denied" | "timeout" | "unavailable" | "error", message?: string) => {
      if (!laravel) return;
      try {
        await callPortalApi("/api/v1/portal/attendance/geo-permission", {
          method: "POST",
          body: JSON.stringify({ status, context: "check_in", message: message ?? null }),
        });
      } catch { /* best-effort audit */ }
    },
    [laravel],
  );

  const handlePunch = useCallback(async (action: "check_in" | "check_out") => {
    setLastAction(action);
    setGeoError(null);
    if (!navigator.geolocation) {
      const msg = "Geolocation not supported by this browser";
      setGeoError(msg);
      await logGeoPermission("unavailable", msg);
      toast({ title: msg, variant: "destructive" });
      return;
    }
    setChecking(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await logGeoPermission("granted");
        try {
          const res = await callPortalApi("/api/v1/portal/attendance/self", {
            method: "POST",
            body: JSON.stringify({
              action,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          });
          const src = res.branch_source ? ` · via ${res.branch_source} branch` : "";
          toast({
            title: action === "check_in" ? "Checked in" : "Checked out",
            description: `Distance: ${res.distance_m}m from branch${src}`,
          });
          setGeoError(null);
          await loadToday();
        } catch (e: any) {
          setGeoError(e.message);
          toast({ title: "Attendance failed", description: e.message, variant: "destructive" });
        } finally {
          setChecking(false);
        }
      },
      async (err) => {
        setChecking(false);
        const status =
          err.code === err.PERMISSION_DENIED ? "denied" :
          err.code === err.TIMEOUT ? "timeout" :
          err.code === err.POSITION_UNAVAILABLE ? "unavailable" : "error";
        const msg =
          status === "denied"
            ? "Location permission was denied. Enable location for this site in your browser settings and click Retry."
            : status === "timeout"
              ? "Location request timed out. Move to a spot with better GPS/Wi-Fi and click Retry."
              : err.message || "Unable to get your location. Click Retry.";
        setGeoError(msg);
        await logGeoPermission(status, err.message);
        toast({ title: "Location required", description: msg, variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, [loadToday, logGeoPermission, toast]);

  if (loading) return <div className="text-center py-16 text-muted-foreground">Loading...</div>;
  if (!employee) return <div className="text-center py-16 text-muted-foreground">No employee profile linked.</div>;

  const statusBadge = (s: string) => {
    const v = s === "present" ? "default" : s === "absent" ? "destructive" : "secondary";
    return <Badge variant={v} className="capitalize">{s}</Badge>;
  };

  const present = attendance.filter(a => a.status === "present").length;
  const absent = attendance.filter(a => a.status === "absent").length;
  const late = attendance.filter(a => a.status === "late").length;
  const leave = attendance.filter(a => a.status === "leave").length;

  const summaryCards = [
    { label: "Present", count: present, icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10" },
    { label: "Absent", count: absent, icon: XCircle, color: "text-destructive", bg: "bg-destructive/10" },
    { label: "Late", count: late, icon: AlertCircle, color: "text-yellow-500", bg: "bg-yellow-500/10" },
    { label: "Leave", count: leave, icon: CalendarDays, color: "text-blue-500", bg: "bg-blue-500/10" },
  ];

  const canPunch = laravel && !isHrAdmin;
  const branchConfigured = branchGeo && branchGeo.latitude != null && branchGeo.longitude != null;

  return (
    <div className="space-y-0">
      {isHrAdmin && (
        <PortalEmployeeSelector employees={allEmployees} selectedId={selectedEmployeeId} onSelect={selectEmployee} />
      )}
      <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div><h1 className="text-2xl font-bold text-foreground">My Attendance</h1></div>
          <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /><Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-44" /></div>
        </div>

        {canPunch && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="font-medium">Geo-Fence Attendance</span>
                {branchGeo && (
                  <span className="text-xs text-muted-foreground">
                    {branchGeo.name} · radius {branchGeo.geofence_radius_m}m
                  </span>
                )}
              </div>
              {!branchConfigured ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
                  <p className="font-semibold">Branch location is not configured.</p>
                  <p className="text-destructive/90">Please ask your administrator to complete the following:</p>
                  <ol className="list-decimal ml-5 space-y-0.5 text-destructive/90">
                    <li>Open <b>Admin → Branches</b>.</li>
                    <li>Edit your branch and set <b>Latitude</b> (−90 to 90) and <b>Longitude</b> (−180 to 180).</li>
                    <li>Set the geo-fence <b>Radius</b> in metres and save.</li>
                  </ol>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xs text-muted-foreground">
                    Today: {today?.check_in ? <>In <b>{today.check_in}</b></> : "not checked in"}
                    {today?.check_out ? <> · Out <b>{today.check_out}</b></> : null}
                  </div>
                  <div className="flex gap-2 ml-auto">
                    <Button
                      size="sm"
                      onClick={() => handlePunch("check_in")}
                      disabled={checking || !!today?.check_in}
                    >
                      <LogIn className="w-4 h-4 mr-1" /> Check In
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePunch("check_out")}
                      disabled={checking || !today?.check_in || !!today?.check_out}
                    >
                      <LogOut className="w-4 h-4 mr-1" /> Check Out
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryCards.map(({ label, count, icon: Icon, color, bg }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{count}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card><CardContent className="pt-6">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Check In</TableHead><TableHead>Check Out</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {attendance.map(a => (
                <TableRow key={a.id}>
                  <TableCell>{a.date}</TableCell>
                  <TableCell>{a.check_in || "-"}</TableCell>
                  <TableCell>{a.check_out || "-"}</TableCell>
                  <TableCell>{statusBadge(a.status)}</TableCell>
                </TableRow>
              ))}
              {attendance.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No records</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
    </div>
  );
}
