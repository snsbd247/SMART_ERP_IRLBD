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
import { CreditCard, Printer, Download, MapPin } from "lucide-react";

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
    const logoHtml = companyLogo
      ? `<img src="${companyLogo}" class="logo" crossorigin="anonymous" />`
      : `<div class="logo lp">${companyName[0]}</div>`;
    const factoryHtml = factoryAddr
      ? `<div class="sec"><div class="st"><span>Factory:</span></div><p class="sb">${factoryAddr.replace(/\n/g, "<br/>")}${companyPhone ? `<br/>Phone: ${companyPhone}` : ""}${companyEmail ? `<br/>Email: ${companyEmail}` : ""}</p></div>` : "";
    const headHtml = headOfficeAddr
      ? `<div class="sec"><div class="st"><span>Head Office</span></div><p class="sb">${headOfficeAddr.replace(/\n/g, "<br/>")}${!factoryAddr && companyPhone ? `<br/>Phone: ${companyPhone}` : ""}${!factoryAddr && companyEmail ? `<br/>Email: ${companyEmail}` : ""}</p></div>` : "";

    return `<html><head><title>ID Card - ${emp!.employee_code}</title>
      <meta name="format-detection" content="telephone=no,email=no,address=no" />
      <style>
      @page { size: 54mm 85.6mm; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      a { color: inherit !important; text-decoration: none !important; }
      body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #000; }
      .card { width: 54mm; height: 85.6mm; overflow: hidden; background: #fff; position: relative; page-break-after: always; }
      .card:last-child { page-break-after: auto; }

      /* FRONT */
      .front .top { background: #ef7a1a; padding: 3mm 3mm 4mm; height: 54mm; }
      .front .brand { display: flex; align-items: center; gap: 2mm; margin-bottom: 2.5mm; }
      .front .logo { height: 9mm; width: 9mm; object-fit: contain; background: #fff; padding: 0.4mm; border-radius: 1mm; }
      .front .logo.lp { display:flex; align-items:center; justify-content:center; font-weight:800; color:#ef7a1a; font-size:5mm; }
      .front .brand-en { font-size: 6mm; font-weight: 900; color: #111; font-style: italic; letter-spacing: 0.3mm; line-height: 1; text-transform: uppercase; }
      .front .photo-wrap { display: flex; justify-content: center; margin-top: 1.5mm; }
      .front .photo { width: 28mm; height: 32mm; object-fit: cover; border: 0.8mm solid #2f6bd6; background: #fff; }
      .front .photo.ph { display:flex; align-items:center; justify-content:center; font-size:10mm; font-weight:700; color:#475569; }
      .front .bottom { padding: 3mm 2mm 2mm; text-align: center; }
      .front .name { font-size: 4mm; font-weight: 800; color: #000; }
      .front .desig { font-size: 2.8mm; color: #000; margin-top: 0.5mm; }
      .front .bc { margin-top: 2.5mm; }
      .front .bc img { height: 11mm; width: 40mm; object-fit: fill; }
      .front .bc p { font-size: 3mm; font-weight: 700; letter-spacing: 1mm; margin-top: 0.5mm; color: #000; }

      /* BACK */
      .back { display: flex; }
      .back .main { flex: 1; padding: 3mm 2.5mm 2mm; display: flex; flex-direction: column; color: #000; }
      .back .sec { margin-bottom: 2mm; }
      .back .st { display:flex; justify-content:center; margin-bottom: 1mm; }
      .back .st span { position: relative; font-size: 2.6mm; font-weight: 800; color: #000; padding: 0 2mm; }
      .back .st span::before, .back .st span::after { content:""; position:absolute; top:50%; width: 8mm; height: 0.4mm; background: #000; }
      .back .st span::before { right: 100%; } .back .st span::after { left: 100%; }
      .back .sb { font-size: 2.4mm; line-height: 1.4; color: #000; text-align: center; }
      .back .qr { text-align: center; margin-top: 2mm; }
      .back .qr img { width: 22mm; height: 22mm; }
      .back .side { width: 5mm; background: #111; display:flex; align-items:center; justify-content:center; }
      .back .side span { color:#fff; font-size: 2.6mm; font-weight: 700; letter-spacing: 1mm; writing-mode: vertical-rl; transform: rotate(180deg); }
    </style></head><body>
      <div class="card front">
        <div class="top">
          <div class="brand">${logoHtml}<div class="brand-en">${companyName}</div></div>
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

  const handlePrint = () => {
    if (!emp) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(buildCardHtml(getQrDataUrl(), getBarcodeDataUrl()));
    win.document.close();
    setTimeout(() => win.print(), 900);
  };


  const handleDownloadPdf = async () => {
    if (!emp) return;
    try {
      const [{ default: jsPDF }] = await Promise.all([import("jspdf")]);
      // CR80 portrait dimensions
      const W = 53.98, H = 85.6;
      const pdf = new jsPDF({ unit: "mm", format: [W, H], orientation: "portrait" });

      const [logoData, photoData, barcodeData] = await Promise.all([
        companyLogo ? fetchAsDataUrl(companyLogo) : Promise.resolve(null),
        emp.photo_url ? fetchAsDataUrl(emp.photo_url) : Promise.resolve(null),
        fetchAsDataUrl(barcodeUrl),
      ]);
      const qrData = getQrDataUrl();

      // ===== FRONT =====
      pdf.setFillColor(239, 122, 26);
      pdf.rect(0, 0, W, 54, "F");
      // Logo
      if (logoData) {
        pdf.setFillColor(255, 255, 255);
        pdf.rect(3, 3, 8, 8, "F");
        try { pdf.addImage(logoData, "PNG", 3.4, 3.4, 7.2, 7.2); } catch { /* ignore */ }
      }
      // Company name
      pdf.setTextColor(17, 17, 17);
      pdf.setFont("helvetica", "bolditalic");
      pdf.setFontSize(13);
      pdf.text(companyName, 13, 9);
      // Photo
      const photoW = 26, photoH = 32, photoX = (W - photoW) / 2, photoY = 16;
      pdf.setFillColor(47, 107, 214);
      pdf.rect(photoX - 0.8, photoY - 0.8, photoW + 1.6, photoH + 1.6, "F");
      pdf.setFillColor(255, 255, 255);
      pdf.rect(photoX, photoY, photoW, photoH, "F");
      if (photoData) {
        try { pdf.addImage(photoData, "JPEG", photoX, photoY, photoW, photoH); } catch { /* ignore */ }
      } else {
        pdf.setTextColor(71, 85, 105);
        pdf.setFontSize(24);
        pdf.setFont("helvetica", "bold");
        pdf.text(`${emp.first_name[0]}${emp.last_name[0]}`, W / 2, photoY + photoH / 2 + 3, { align: "center" });
      }
      // Name & designation
      pdf.setTextColor(17, 17, 17);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text(`${emp.first_name} ${emp.last_name}`, W / 2, 60, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text(desigName, W / 2, 64, { align: "center" });
      // Barcode
      if (barcodeData) {
        try { pdf.addImage(barcodeData, "PNG", (W - 40) / 2, 68, 40, 11); } catch { /* ignore */ }
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.text(emp.employee_code, W / 2, 82, { align: "center", charSpace: 1.2 });

      // ===== BACK =====
      pdf.addPage([W, H], "portrait");
      // Right black sidebar
      pdf.setFillColor(17, 17, 17);
      pdf.rect(W - 5, 0, 5, H, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      // Rotated vertical text (270deg reads bottom-to-top on right side)
      pdf.text(sidebarText, W - 1.5, H - 5, { angle: 90 });

      let y = 5;
      const drawSection = (title: string, body: string) => {
        pdf.setTextColor(17, 17, 17);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        const midX = (W - 5) / 2;
        pdf.text(title, midX, y + 3, { align: "center" });
        pdf.setDrawColor(17, 17, 17);
        pdf.setLineWidth(0.3);
        pdf.line(midX - 18, y + 2.7, midX - 8, y + 2.7);
        pdf.line(midX + 8, y + 2.7, midX + 18, y + 2.7);
        y += 5;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7);
        const lines = pdf.splitTextToSize(body, W - 10);
        pdf.text(lines, midX, y, { align: "center" });
        y += lines.length * 3 + 2;
      };

      if (factoryAddr) {
        const body = factoryAddr + (companyPhone ? `\nPhone: ${companyPhone}` : "") + (companyEmail ? `\nEmail: ${companyEmail}` : "");
        drawSection("Factory:", body);
      }
      if (headOfficeAddr) {
        const body = headOfficeAddr + (!factoryAddr && companyPhone ? `\nPhone: ${companyPhone}` : "") + (!factoryAddr && companyEmail ? `\nEmail: ${companyEmail}` : "");
        drawSection("Head Office", body);
      }
      // QR
      if (qrData) {
        const qrSize = 22;
        try { pdf.addImage(qrData, "PNG", (W - 5 - qrSize) / 2, H - qrSize - 4, qrSize, qrSize); } catch { /* ignore */ }
      }

      pdf.save(`id-card-${emp.employee_code}.pdf`);
      toast({ title: "PDF downloaded" });
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

              <div className="flex flex-wrap justify-center gap-8">
                {/* FRONT */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground text-center mb-2 uppercase tracking-wider">Front Side</p>
                  <div className="w-[340px] h-[540px] rounded-md overflow-hidden bg-white shadow-lg relative">
                    <div className="bg-[#ef7a1a] px-4 pt-4 pb-5 h-[340px]">
                      <div className="flex items-center gap-2.5 mb-3">
                        {companyLogo ? (
                          <img src={companyLogo} alt="Logo" className="h-11 w-11 object-contain bg-white p-0.5 rounded" />
                        ) : (
                          <div className="h-11 w-11 rounded bg-white flex items-center justify-center text-[#ef7a1a] font-extrabold text-xl">{companyName[0]}</div>
                        )}
                        <div className="text-[22px] font-extrabold italic text-black tracking-wide leading-none">{companyName}</div>
                      </div>
                      <div className="flex justify-center mt-1">
                        {emp.photo_url ? (
                          <img src={emp.photo_url} alt="Photo" className="w-40 h-[190px] object-cover border-[3px] border-[#2f6bd6] bg-white" />
                        ) : (
                          <div className="w-40 h-[190px] border-[3px] border-[#2f6bd6] bg-white flex items-center justify-center text-4xl font-bold text-slate-600">
                            {emp.first_name[0]}{emp.last_name[0]}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="px-3 pt-4 pb-3 text-center">
                      <p className="text-lg font-extrabold text-black">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-neutral-700 mt-0.5">{desigName}</p>
                      <div className="mt-3">
                        <img src={barcodeUrl} alt="Barcode" className="h-[55px] w-[220px] object-fill mx-auto" />
                        <p className="text-sm font-bold tracking-[6px] text-black mt-1">{emp.employee_code}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* BACK */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground text-center mb-2 uppercase tracking-wider">Back Side</p>
                  <div className="w-[340px] h-[540px] rounded-md overflow-hidden bg-white shadow-lg flex flex-row">
                    <div className="flex-1 px-3.5 pt-4 pb-3 flex flex-col">
                      {factoryAddr && (
                        <div className="mb-2.5">
                          <div className="flex items-center justify-center mb-1.5">
                            <span className="relative px-2.5 text-xs font-extrabold text-black
                              before:content-[''] before:absolute before:top-1/2 before:right-full before:w-10 before:h-[2px] before:bg-black
                              after:content-[''] after:absolute after:top-1/2 after:left-full after:w-10 after:h-[2px] after:bg-black">
                              Factory:
                            </span>
                          </div>
                          <p className="text-[11px] leading-snug text-black text-center whitespace-pre-line">
                            {factoryAddr}
                            {companyPhone && <><br />Phone: {companyPhone}</>}
                            {companyEmail && <><br />Email: {companyEmail}</>}
                          </p>
                        </div>
                      )}
                      {headOfficeAddr && (
                        <div className="mb-2">
                          <div className="flex items-center justify-center mb-1.5">
                            <span className="relative px-2.5 text-xs font-extrabold text-black
                              before:content-[''] before:absolute before:top-1/2 before:right-full before:w-10 before:h-[2px] before:bg-black
                              after:content-[''] after:absolute after:top-1/2 after:left-full after:w-10 after:h-[2px] after:bg-black">
                              Head Office
                            </span>
                          </div>
                          <p className="text-[11px] leading-snug text-black text-center whitespace-pre-line">
                            {headOfficeAddr}
                            {!factoryAddr && companyPhone && <><br />Phone: {companyPhone}</>}
                            {!factoryAddr && companyEmail && <><br />Email: {companyEmail}</>}
                          </p>
                        </div>
                      )}
                      {!factoryAddr && !headOfficeAddr && (
                        <p className="text-[11px] text-center text-muted-foreground">
                          Click <b>Configure Addresses</b> above to map Factory and Head Office.
                        </p>
                      )}
                      <div className="mt-auto text-center pt-2">
                        <QRCodeCanvas value={qrPayload} size={120} level="M" includeMargin />
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
