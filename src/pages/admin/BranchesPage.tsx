import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Building2, Search } from "lucide-react";

interface Branch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number | null;
}

const BranchesPage = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [search, setSearch] = useState("");
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formStatus, setFormStatus] = useState("active");
  const [formLat, setFormLat] = useState("");
  const [formLng, setFormLng] = useState("");
  const [formRadius, setFormRadius] = useState("10");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchBranches = async () => {
    setLoading(true);
    const { data } = await supabase.from("branches").select("*").order("name");
    setBranches(((data || []) as unknown as Branch[]));
    setLoading(false);
  };

  useEffect(() => { fetchBranches(); }, []);

  const openCreate = () => {
    setEditBranch(null);
    setFormName(""); setFormCode(""); setFormAddress(""); setFormPhone(""); setFormStatus("active");
    setFormLat(""); setFormLng(""); setFormRadius("10");
    setDialogOpen(true);
  };

  const openEdit = (b: Branch) => {
    setEditBranch(b);
    setFormName(b.name); setFormCode(b.code); setFormAddress(b.address || ""); setFormPhone(b.phone || ""); setFormStatus(b.status);
    setFormLat(b.latitude != null ? String(b.latitude) : "");
    setFormLng(b.longitude != null ? String(b.longitude) : "");
    setFormRadius(b.geofence_radius_m != null ? String(b.geofence_radius_m) : "10");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formCode.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        name: formName, code: formCode, address: formAddress, phone: formPhone, status: formStatus,
        latitude: formLat.trim() === "" ? null : Number(formLat),
        longitude: formLng.trim() === "" ? null : Number(formLng),
        geofence_radius_m: formRadius.trim() === "" ? 10 : Number(formRadius),
      };
      if (editBranch) {
        const { error } = await supabase.from("branches").update(payload).eq("id", editBranch.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("branches").insert(payload);
        if (error) throw error;
      }
      toast({ title: editBranch ? "Branch updated" : "Branch created" });
      setDialogOpen(false);
      fetchBranches();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this branch?")) return;
    const { error } = await supabase.from("branches").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else fetchBranches();
  };

  const filtered = branches.filter((b) =>
    !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Branch Management</h1>
        <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" />Add Branch</Button>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search branches..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No branches found</TableCell></TableRow>
              ) : filtered.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />{b.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{b.code}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{b.address || "—"}</TableCell>
                  <TableCell className="text-sm">{b.phone || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={b.status === "active" ? "default" : "secondary"} className="text-xs">{b.status}</Badge>
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(b)} className="h-8 w-8"><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(b.id)} className="h-8 w-8"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editBranch ? "Edit Branch" : "Create Branch"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Branch Name</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Branch Code</Label>
                <Input value={formCode} onChange={(e) => setFormCode(e.target.value)} placeholder="e.g. BR-001" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Address</Label>
              <Input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Geo-Fence Attendance</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    if (!navigator.geolocation) return;
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        setFormLat(pos.coords.latitude.toFixed(7));
                        setFormLng(pos.coords.longitude.toFixed(7));
                      },
                      () => toast({ title: "Unable to get current location", variant: "destructive" }),
                      { enableHighAccuracy: true }
                    );
                  }}
                >
                  Use my current location
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Latitude</Label>
                  <Input value={formLat} onChange={(e) => setFormLat(e.target.value)} placeholder="23.7808" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Longitude</Label>
                  <Input value={formLng} onChange={(e) => setFormLng(e.target.value)} placeholder="90.2792" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Radius (m)</Label>
                  <Input type="number" min={1} value={formRadius} onChange={(e) => setFormRadius(e.target.value)} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} size="sm">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} size="sm">{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BranchesPage;
