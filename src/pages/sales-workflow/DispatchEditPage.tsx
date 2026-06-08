import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

export default function DispatchEditPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    swApi.getDispatch(id!).then(({ data }) => {
      if (!data) return;
      setForm({
        dispatch_date: data.dispatch_date || "",
        vehicle_no: data.vehicle_no || "",
        driver_name: data.driver_name || "",
        driver_phone: data.driver_phone || "",
        notes: data.notes || "",
      });
    });
  }, [id]);
  if (!form) return <div className="p-6">Loading…</div>;
  const save = async () => {
    const { error } = await swApi.updateDispatchHeader(id!, form);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: "Dispatch updated" });
    nav(`/sales-workflow/dispatch/${id}`);
  };
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Edit Dispatch (Header)</h1>
      <p className="text-sm text-muted-foreground">Items & allocations cannot be edited after creation. Delete and re-create if needed.</p>
      <Card className="p-4 grid md:grid-cols-2 gap-4">
        <div><Label>Date</Label><Input type="date" value={form.dispatch_date} onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })} /></div>
        <div><Label>Vehicle No</Label><Input value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })} /></div>
        <div><Label>Driver</Label><Input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></div>
        <div><Label>Driver Phone</Label><Input value={form.driver_phone} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} /></div>
        <div className="md:col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </Card>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
        <Button onClick={save}>Update</Button>
      </div>
    </div>
  );
}
