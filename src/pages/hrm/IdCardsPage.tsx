import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { QRCodeCanvas } from "qrcode.react";
import JsBarcode from "jsbarcode";
import { CreditCard, Printer, Download, MapPin, Minus, Plus } from "lucide-react";
import { BACK_QR, BACK_FONT_SCALE, backCssBlock, pageFrameCss } from "./idCardLayout";

interface Employee {
  id: string; employee_code: string; first_name: string; last_name: string;
  department_id: string | null; designation_id: string | null; joining_date: string;
  photo_url: string | null; status: string;
}
interface Desig { id: string; name: string; }

function splitAddresses(raw: string | null | undefined): { factory: string; head: string } {
  const text = (raw || "").trim();
  if (!text) return { factory: "", head: "" };
  if (/factory\s*:/i.test(text) && /head\s*office\s*:/i.test(text)) {
    const [f, h] = text.split(/head\s*office\s*:/i);
    return { factory: f.replace(/factory\s*:/i, "").trim(), head: (h || "").trim() };
  }
  if (text.includes("|")) {
    const [f, h] = text.split("|");
    return { factory: (f || "").trim(), head: (h || "").trim() };
  }
  const parts = text.split(/\n\s*\n/);
  if (parts.length >= 2) return { factory: parts[0].trim(), head: parts.slice(1).join("\n").trim() };
  return { factory: "", head: text };
}

function mergeAddresses(factory: string, head: string): string {
  const f = factory.trim();
  const h = head.trim();
  if (!f && !h) return "";
  if (f && h) return `Factory:\n${f}\n\nHead Office:\n${h}`;
  if (f) return `Factory:\n${f}`;
  return `Head Office:\n${h}`;
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export default function IdCardsPage() {
  const { settings, refetch } = useCompanySettings();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [designations, setDesignations] = useState<Desig[]>([]);
  const [selectedEmp, setSelectedEmp] = useState("");
  const [addrDialog, setAddrDialog] = useState(false);
  const [factoryInput, setFactoryInput] = useState("");
  const [headInput, setHeadInput] = useState("");
  const [savingAddr, setSavingAddr] = useState(false);
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const barcodeRef = useRef<HTMLCanvasElement | null>(null);
  const frontCardRef = useRef<HTMLDivElement | null>(null);
  const backCardRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<"both" | "front" | "back">("both");



  useEffect(() => {
    (async () => {
      const [e, ds] = await Promise.all([
        supabase.from("employees" as any).select("*").order("first_name"),
        supabase.from("designations" as any).select("id, name"),
      ]);
      if (e.data) setEmployees(e.data as any);
      if (ds.data) setDesignations(ds.data as any);
    })();
  }, []);

  const emp = employees.find((e) => e.id === selectedEmp);
  const desigName = emp ? designations.find((d) => d.id === emp.designation_id)?.name || "-" : "";
  const companyName = settings?.company_name || "Company";
  const companyPhone = settings?.phone || "";
  const companyEmail = settings?.email || "";
  const companyWebsite = settings?.website || "";
  const companyLogo = settings?.company_logo_url || "";
  const { factory: factoryAddr, head: headOfficeAddr } = splitAddresses(settings?.address);

  const verifyUrl = emp ? `${window.location.origin}/employee/verify/${emp.employee_code}` : "";
  const qrPayload = emp ? `${verifyUrl}?eid=${encodeURIComponent(emp.employee_code)}` : "";
  const rawSite = (companyWebsite || "").replace(/^https?:\/\//i, "").replace(/\/$/, "").toUpperCase();
  const sidebarText = rawSite ? (rawSite.startsWith("WWW.") ? rawSite : `WWW.${rawSite}`) : `WWW.${companyName.replace(/\s+/g, "").toUpperCase()}.COM`;

  // Render barcode locally with JsBarcode whenever employee changes
  useEffect(() => {
    if (emp && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, emp.employee_code, {
          format: "CODE128", displayValue: false, height: 55, width: 2,
          margin: 0, background: "#ffffff", lineColor: "#000000",
        });
      } catch { /* ignore */ }
    }
  }, [emp?.id]);


  const openAddrDialog = () => {
    setFactoryInput(factoryAddr);
    setHeadInput(headOfficeAddr);
    setAddrDialog(true);
  };

  const saveAddresses = async () => {
    if (!settings) return;
    setSavingAddr(true);
    const combined = mergeAddresses(factoryInput, headInput);
    try {
      const base = getApiBaseUrl();
      if (base) {
        const { id, ...rest } = settings;
        const res = await fetch(`${base}/v1/settings/company`, {
          method: "PUT",
          headers: { ...getLaravelAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ ...rest, address: combined }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        const { error } = await supabase
          .from("company_settings" as any)
          .update({ address: combined, updated_at: new Date().toISOString() })
          .eq("id", settings.id);
        if (error) throw error;
      }
      toast({ title: "Addresses updated" });
      setAddrDialog(false);
      refetch();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingAddr(false);
    }
  };

  const getBarcodeDataUrl = (): string => {
    const c = barcodeRef.current;
    return c ? c.toDataURL("image/png") : "";
  };

  const buildCardHtml = (qrDataUrl: string, barcodeDataUrl: string) => {
    const photoHtml = emp?.photo_url
      ? `<img src="${emp.photo_url}" class="photo" crossorigin="anonymous" />`
      : `<div class="photo ph">${emp!.first_name[0]}${emp!.last_name[0]}</div>`;
    const brandInner = companyLogo
      ? `<img src="${companyLogo}" class="logo" crossorigin="anonymous" />`
      : `<div class="brand-en">${companyName}</div>`;
    const factoryHtml = factoryAddr
      ? `<div class="sec"><div class="st"><span>Factory:</span></div><p class="sb">${factoryAddr.replace(/\n/g, "<br/>")}${companyPhone ? `<br/>Phone: <span class="hl">${companyPhone}</span>` : ""}${companyEmail ? `<br/>Email: <span class="hl">${companyEmail}</span>` : ""}</p></div>` : "";
    const headHtml = headOfficeAddr
      ? `<div class="sec"><div class="st"><span>Head Office</span></div><p class="sb">${headOfficeAddr.replace(/\n/g, "<br/>")}${!factoryAddr && companyPhone ? `<br/>Phone: <span class="hl">${companyPhone}</span>` : ""}${!factoryAddr && companyEmail ? `<br/>Email: <span class="hl">${companyEmail}</span>` : ""}</p></div>` : "";

    return `<html><head><title>ID Card - ${emp!.employee_code}</title>
      <meta name="format-detection" content="telephone=no,email=no,address=no" />
      <style>
      ${pageFrameCss()}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      a { color: inherit !important; text-decoration: none !important; }
      body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #000; }

      /* FRONT */
      .front .top { background: #ef7a1a; padding: 3mm 3mm 4mm; height: 54mm; }
      .front .brand { display: flex; align-items: center; justify-content: center; margin-bottom: 2.5mm; height: 12mm; }
      .front .logo { max-height: 12mm; width: auto; object-fit: contain; background: transparent; }
      .front .brand-en { font-size: 5mm; font-weight: 900; color: #111; font-style: italic; letter-spacing: 0.3mm; line-height: 1; text-transform: uppercase; text-align: center; }
      .front .photo-wrap { display: flex; justify-content: center; margin-top: 1.5mm; }
      .front .photo { width: 28mm; height: 32mm; object-fit: cover; border: 0.8mm solid #2f6bd6; background: #fff; }
      .front .photo.ph { display:flex; align-items:center; justify-content:center; font-size:10mm; font-weight:700; color:#475569; }
      .front .bottom { padding: 3mm 2mm 2mm; text-align: center; }
      .front .name { font-size: 4mm; font-weight: 800; color: #000; }
      .front .desig { font-size: 2.8mm; color: #000; margin-top: 0.5mm; }
      .front .bc { margin-top: 2.5mm; }
      .front .bc img { height: 11mm; width: 40mm; object-fit: fill; }
      .front .bc p { font-size: 3mm; font-weight: 700; letter-spacing: 1mm; margin-top: 0.5mm; color: #000; }

      /* BACK — sample-aligned (shared with tests) */
      ${backCssBlock()}
    </style></head><body>
      <div class="card front">
        <div class="top">
          <div class="brand">${brandInner}</div>
          <div class="photo-wrap">${photoHtml}</div>
        </div>
        <div class="bottom">
          <p class="name">${emp!.first_name} ${emp!.last_name}</p>
          <p class="desig">${desigName}</p>
          <div class="bc"><img src="${barcodeDataUrl}" /><p>${emp!.employee_code}</p></div>
        </div>
      </div>
      <div class="card back">
        <div class="main">${factoryHtml}${headHtml}<div class="qr"><img src="${qrDataUrl}" /></div></div>
        <div class="side"><span>${sidebarText}</span></div>
      </div>
    </body></html>`;
  };

  const getQrDataUrl = (): string => {
    const c = qrRef.current;
    return c ? c.toDataURL("image/png") : "";
  };

  // Snapshot the actual rendered card DOM so preview === print === PDF (CR80 exact).
  const snapshotCards = async (): Promise<{ front: string; back: string } | null> => {
    if (!frontCardRef.current || !backCardRef.current) return null;
    const [{ default: html2canvas }] = await Promise.all([import("html2canvas")]);
    const opts = { scale: 4, backgroundColor: "#ffffff", useCORS: true, logging: false } as any;
    // Force both refs visible for snapshot even if user picked front/back only
    const wasFrontHidden = frontCardRef.current.style.display === "none";
    const wasBackHidden = backCardRef.current.style.display === "none";
    if (wasFrontHidden) frontCardRef.current.style.display = "";
    if (wasBackHidden) backCardRef.current.style.display = "";
    const [f, b] = await Promise.all([
      html2canvas(frontCardRef.current, opts),
      html2canvas(backCardRef.current, opts),
    ]);
    if (wasFrontHidden) frontCardRef.current.style.display = "none";
    if (wasBackHidden) backCardRef.current.style.display = "none";
    return { front: f.toDataURL("image/png"), back: b.toDataURL("image/png") };
  };

  const handlePrint = async () => {
    if (!emp) return;
    const snaps = await snapshotCards();
    if (!snaps) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<html><head><title>ID Card - ${emp.employee_code}</title>
      <style>
        @page { size: 53.98mm 85.6mm; margin: 0; }
        * { margin:0; padding:0; box-sizing:border-box; }
        html, body { background:#fff; }
        .card { width: 53.98mm; height: 85.6mm; page-break-after: always; display:block; }
        .card:last-child { page-break-after: auto; }
        .card img { width: 53.98mm; height: 85.6mm; display:block; }
      </style></head><body>
      <div class="card"><img src="${snaps.front}" /></div>
      <div class="card"><img src="${snaps.back}" /></div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300);</script>
    </body></html>`);
    win.document.close();
  };

  const handleDownloadPdf = async () => {
    if (!emp) return;
    try {
      const snaps = await snapshotCards();
      if (!snaps) return;
      const [{ default: jsPDF }] = await Promise.all([import("jspdf")]);
      const W = 53.98, H = 85.6;
      const pdf = new jsPDF({ unit: "mm", format: [W, H], orientation: "portrait" });
      pdf.addImage(snaps.front, "PNG", 0, 0, W, H, undefined, "FAST");
      pdf.addPage([W, H], "portrait");
      pdf.addImage(snaps.back, "PNG", 0, 0, W, H, undefined, "FAST");
      pdf.save(`id-card-${emp.employee_code}.pdf`);
      toast({ title: "PDF downloaded", description: `Verify URL: ${verifyUrl}` });
    } catch (err: any) {
      toast({ title: "PDF failed", description: err.message, variant: "destructive" });
    }
  };


  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Employee ID Cards</h1>
        <p className="text-muted-foreground">Generate and print professional employee ID cards with QR & barcode</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5" />ID Card Generator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-8">
            <div className="w-80">
              <Label>Select Employee</Label>
              <Select value={selectedEmp} onValueChange={setSelectedEmp}>
                <SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={openAddrDialog}><MapPin className="w-4 h-4 mr-2" />Configure Addresses</Button>
            {emp && (
              <>
                <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 mr-2" />Print</Button>
                <Button onClick={handleDownloadPdf}><Download className="w-4 h-4 mr-2" />Download PDF</Button>
              </>
            )}
          </div>

          {emp && (
            <>
              {/* Hidden QR canvas used by print + PDF export */}
              <div className="hidden">
                <QRCodeCanvas value={qrPayload} size={256} level="M" ref={qrRef as any} includeMargin />
              </div>

              {/* View mode toggle */}
              <div className="flex items-center justify-center gap-2 mb-4">
                {(["both", "front", "back"] as const).map((m) => (
                  <Button key={m} size="sm" variant={viewMode === m ? "default" : "outline"} onClick={() => setViewMode(m)}>
                    {m === "both" ? "Both" : m === "front" ? "Front" : "Back"}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap justify-center gap-8">
                {/* FRONT — 340×539 preview = exact CR80 (54×85.6mm) at ~6.3 px/mm */}
                <div style={{ display: viewMode === "back" ? "none" : "block" }}>
                  <p className="text-xs font-semibold text-muted-foreground text-center mb-2 uppercase tracking-wider">Front Side</p>
                  <div ref={frontCardRef} className="w-[340px] h-[539px] overflow-hidden bg-white shadow-lg relative">

                    <div className="bg-[#ef7a1a] px-4 pt-3 pb-4 h-[340px]">
                      <div className="flex items-center justify-center mb-2 h-12">
                        {companyLogo ? (
                          <img src={companyLogo} alt="Logo" className="max-h-12 w-auto object-contain" />
                        ) : (
                          <div className="text-[22px] font-black italic text-black tracking-wide leading-none uppercase text-center">{companyName}</div>
                        )}
                      </div>
                      <div className="flex justify-center mt-2">
                        {emp.photo_url ? (
                          <img src={emp.photo_url} alt="Photo" className="w-44 h-[210px] object-cover border-[3px] border-[#2f6bd6] bg-white" />
                        ) : (
                          <div className="w-44 h-[210px] border-[3px] border-[#2f6bd6] bg-white flex items-center justify-center text-4xl font-bold text-slate-600">
                            {emp.first_name[0]}{emp.last_name[0]}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="px-3 pt-4 pb-3 text-center">
                      <p className="text-lg font-extrabold" style={{ color: "#000" }}>{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#000" }}>{desigName}</p>
                      <div className="mt-3 flex flex-col items-center">
                        <canvas ref={barcodeRef} className="h-[55px] w-[220px]" />
                        <p className="text-sm font-bold tracking-[4px] mt-1" style={{ color: "#000" }}>{emp.employee_code}</p>
                      </div>
                    </div>
                  </div>
                </div>


                {/* BACK */}
                <div style={{ display: viewMode === "front" ? "none" : "block" }}>
                  <p className="text-xs font-semibold text-muted-foreground text-center mb-2 uppercase tracking-wider">Back Side</p>
                  <div ref={backCardRef} className="w-[340px] h-[539px] overflow-hidden bg-white shadow-lg flex flex-row">

                    <div className="flex-1 px-3 pt-4 pb-3 flex flex-col">
                      {factoryAddr && (
                        <div className="mb-2">
                          <div className="flex items-center justify-center mb-1">
                            <span className="relative px-2.5 text-[13px] font-extrabold text-black">
                              <span className="absolute top-1/2 right-full w-8 h-[1.5px] bg-black" />
                              Factory:
                              <span className="absolute top-1/2 left-full w-8 h-[1.5px] bg-black" />
                            </span>
                          </div>
                          <div className="text-[10.5px] leading-[1.35] text-center whitespace-pre-line" style={{ color: "#1e3a8a" }}>
                            {factoryAddr}
                          </div>
                          {companyPhone && (
                            <div className="text-[10.5px] leading-[1.35] text-center" style={{ color: "#1e3a8a" }}>
                              Phone: <span style={{ color: "#dc2626" }}>{companyPhone}</span>
                            </div>
                          )}
                          {companyEmail && (
                            <div className="text-[10.5px] leading-[1.35] text-center" style={{ color: "#1e3a8a" }}>
                              Email: <span style={{ color: "#dc2626" }}>{companyEmail}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {headOfficeAddr && (
                        <div className="mb-1">
                          <div className="flex items-center justify-center mb-1">
                            <span className="relative px-2.5 text-[13px] font-extrabold text-black">
                              <span className="absolute top-1/2 right-full w-8 h-[1.5px] bg-black" />
                              Head Office
                              <span className="absolute top-1/2 left-full w-8 h-[1.5px] bg-black" />
                            </span>
                          </div>
                          <div className="text-[10.5px] leading-[1.35] text-center whitespace-pre-line" style={{ color: "#1e3a8a" }}>
                            {headOfficeAddr}
                          </div>
                          {!factoryAddr && companyPhone && (
                            <div className="text-[10.5px] leading-[1.35] text-center" style={{ color: "#1e3a8a" }}>
                              Phone: <span style={{ color: "#dc2626" }}>{companyPhone}</span>
                            </div>
                          )}
                          {!factoryAddr && companyEmail && (
                            <div className="text-[10.5px] leading-[1.35] text-center" style={{ color: "#1e3a8a" }}>
                              Email: <span style={{ color: "#dc2626" }}>{companyEmail}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {!factoryAddr && !headOfficeAddr && (
                        <p className="text-[11px] text-center text-muted-foreground">
                          Click <b>Configure Addresses</b> above to map Factory and Head Office.
                        </p>
                      )}
                      <div className="mt-auto flex justify-center pt-1 pb-2">
                        <QRCodeCanvas value={qrPayload} size={BACK_QR.onScreenPx} level="M" includeMargin={false} />
                      </div>
                    </div>

                    <div className="w-8 bg-black flex items-center justify-center">
                      <span
                        className="text-white font-bold text-sm tracking-[3px]"
                        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                      >
                        {sidebarText}
                      </span>
                    </div>

                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={addrDialog} onOpenChange={setAddrDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MapPin className="w-4 h-4" />Configure Card Addresses</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              These addresses appear on the back of every printed ID card. Leave one blank to show only the other.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Factory Address</Label>
              <Textarea
                rows={4}
                value={factoryInput}
                onChange={(e) => setFactoryInput(e.target.value)}
                placeholder="Plot A22-23, BSCIC Industrial Estate,&#10;Konabari, Gazipur-1702, Bangladesh."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Head Office Address</Label>
              <Textarea
                rows={4}
                value={headInput}
                onChange={(e) => setHeadInput(e.target.value)}
                placeholder="Concord Royal Court, B-1 4th Floor,&#10;House# 40, Road# 27, Dhanmondi, Dhaka-1209."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddrDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={saveAddresses} disabled={savingAddr}>
              {savingAddr ? "Saving..." : "Save Addresses"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
