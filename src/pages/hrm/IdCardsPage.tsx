import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CreditCard, Printer } from "lucide-react";

interface Employee {
  id: string; employee_code: string; first_name: string; last_name: string;
  department_id: string | null; designation_id: string | null; joining_date: string;
  photo_url: string | null; status: string;
}
interface Dept { id: string; name: string; }
interface Desig { id: string; name: string; }

// Split company address into Factory + Head Office when the user separates them with
// blank line, "|", or literal "Factory:"/"Head Office:" tags. Falls back to a single block.
function splitAddresses(raw: string | null | undefined): { factory: string; head: string } {
  const text = (raw || "").trim();
  if (!text) return { factory: "", head: "" };
  const tagged = /factory\s*:/i.test(text) && /head\s*office\s*:/i.test(text);
  if (tagged) {
    const [f, h] = text.split(/head\s*office\s*:/i);
    return {
      factory: f.replace(/factory\s*:/i, "").trim(),
      head: (h || "").trim(),
    };
  }
  if (text.includes("|")) {
    const [f, h] = text.split("|");
    return { factory: (f || "").trim(), head: (h || "").trim() };
  }
  const parts = text.split(/\n\s*\n/);
  if (parts.length >= 2) return { factory: parts[0].trim(), head: parts.slice(1).join("\n").trim() };
  return { factory: "", head: text };
}

export default function IdCardsPage() {
  const { settings } = useCompanySettings();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [designations, setDesignations] = useState<Desig[]>([]);
  const [selectedEmp, setSelectedEmp] = useState("");

  useEffect(() => {
    (async () => {
      const [e, d, ds] = await Promise.all([
        supabase.from("employees" as any).select("*").order("first_name"),
        supabase.from("departments" as any).select("id, name"),
        supabase.from("designations" as any).select("id, name"),
      ]);
      if (e.data) setEmployees(e.data as any);
      if (d.data) setDepartments(d.data as any);
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
  const qrUrl = emp
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verifyUrl)}`
    : "";
  const barcodeUrl = emp ? `https://barcodeapi.org/api/code128/${emp.employee_code}` : "";

  const sidebarText = (companyWebsite || `www.${companyName}.com`)
    .replace(/^https?:\/\//i, "")
    .toUpperCase();

  const contactLines: string[] = [];
  if (companyPhone) contactLines.push(`Phone: ${companyPhone}`);
  if (companyEmail) contactLines.push(`Email: ${companyEmail}`);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win || !emp) return;
    const photoHtml = emp.photo_url
      ? `<img src="${emp.photo_url}" class="photo" />`
      : `<div class="photo ph">${emp.first_name[0]}${emp.last_name[0]}</div>`;
    const logoHtml = companyLogo
      ? `<img src="${companyLogo}" class="logo" />`
      : `<div class="logo lp">${companyName[0]}</div>`;

    const factoryHtml = factoryAddr
      ? `<div class="sec">
           <div class="sec-title"><span>Factory:</span></div>
           <p class="sec-body">${factoryAddr.replace(/\n/g, "<br/>")}${
          companyPhone ? `<br/>Phone: ${companyPhone}` : ""
        }${companyEmail ? `<br/>Email: ${companyEmail}` : ""}</p>
         </div>`
      : "";
    const headHtml = headOfficeAddr
      ? `<div class="sec">
           <div class="sec-title"><span>Head Office</span></div>
           <p class="sec-body">${headOfficeAddr.replace(/\n/g, "<br/>")}${
          !factoryAddr && companyPhone ? `<br/>Phone: ${companyPhone}` : ""
        }${!factoryAddr && companyEmail ? `<br/>Email: ${companyEmail}` : ""}</p>
         </div>`
      : "";

    win.document.write(`<html><head><title>ID Card - ${emp.employee_code}</title><style>
      @page { size: landscape; margin: 10mm; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f0f0f0; gap: 30px; flex-wrap: wrap; }
      .card { width: 340px; height: 540px; border-radius: 6px; overflow: hidden; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.15); position: relative; }

      /* ---------- FRONT ---------- */
      .front .top { background: #ef7a1a; padding: 14px 16px 20px; height: 340px; position: relative; }
      .front .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
      .front .logo { height: 42px; width: 42px; object-fit: contain; background: #fff; padding: 2px; border-radius: 4px; }
      .front .logo.lp { display:flex; align-items:center; justify-content:center; font-weight:800; color:#ef7a1a; font-size:20px; }
      .front .brand-text { line-height: 1.05; }
      .front .brand-en { font-size: 22px; font-weight: 800; color: #111; letter-spacing: 0.5px; font-style: italic; }
      .front .brand-bn { font-size: 12px; color: #111; margin-top: 2px; }
      .front .brand-tag { font-size: 9px; color: #111; margin-top: 3px; font-style: italic; text-align: right; }
      .front .photo-wrap { display: flex; justify-content: center; margin-top: 6px; }
      .front .photo { width: 160px; height: 190px; object-fit: cover; border: 3px solid #2f6bd6; background: #fff; }
      .front .photo.ph { display:flex; align-items:center; justify-content:center; font-size:48px; font-weight:700; color:#475569; }
      .front .bottom { padding: 18px 12px 14px; text-align: center; }
      .front .emp-name { font-size: 18px; font-weight: 800; color: #111; }
      .front .emp-desig { font-size: 12px; color: #333; margin-top: 2px; }
      .front .barcode { margin-top: 14px; }
      .front .barcode img { height: 46px; }
      .front .barcode p { font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-top: 2px; color: #111; }

      /* ---------- BACK ---------- */
      .back { display: flex; flex-direction: row; }
      .back .main { flex: 1; padding: 18px 14px 14px; display: flex; flex-direction: column; }
      .back .sec { margin-bottom: 10px; }
      .back .sec-title { display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
      .back .sec-title span { font-size: 12px; font-weight: 800; color: #111; padding: 0 10px; position: relative; }
      .back .sec-title span::before, .back .sec-title span::after { content: ""; position: absolute; top: 50%; width: 42px; height: 2px; background: #111; }
      .back .sec-title span::before { right: 100%; }
      .back .sec-title span::after { left: 100%; }
      .back .sec-body { font-size: 11px; line-height: 1.55; color: #111; text-align: center; }
      .back .qr { text-align: center; margin-top: auto; padding-top: 10px; }
      .back .qr img { width: 120px; height: 120px; }
      .back .side { width: 34px; background: #111; display: flex; align-items: center; justify-content: center; }
      .back .side span { color: #fff; font-size: 14px; font-weight: 700; letter-spacing: 3px; writing-mode: vertical-rl; transform: rotate(180deg); }

      @media print { body { background: #fff; } .card { box-shadow: none; } }
    </style></head><body>
      <div class="card front">
        <div class="top">
          <div class="brand">
            ${logoHtml}
            <div class="brand-text">
              <div class="brand-en">${companyName}</div>
              ${settings?.bin_number ? "" : ""}
            </div>
          </div>
          <div class="photo-wrap">${photoHtml}</div>
        </div>
        <div class="bottom">
          <p class="emp-name">${emp.first_name} ${emp.last_name}</p>
          <p class="emp-desig">${desigName}</p>
          <div class="barcode">
            <img src="${barcodeUrl}" alt="Barcode" />
            <p>${emp.employee_code}</p>
          </div>
        </div>
      </div>

      <div class="card back">
        <div class="main">
          ${factoryHtml}
          ${headHtml}
          <div class="qr"><img src="${qrUrl}" alt="QR" /></div>
        </div>
        <div class="side"><span>${sidebarText}</span></div>
      </div>
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 800);
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
          <div className="flex items-end gap-4 mb-8">
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
            {emp && <Button onClick={handlePrint}><Printer className="w-4 h-4 mr-2" />Print ID Card</Button>}
          </div>

          {emp && (
            <div className="flex flex-wrap justify-center gap-8">
              {/* ===== FRONT ===== */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground text-center mb-2 uppercase tracking-wider">Front Side</p>
                <div className="w-[340px] h-[540px] rounded-md overflow-hidden bg-white shadow-lg relative">
                  {/* Orange top block */}
                  <div className="bg-[#ef7a1a] px-4 pt-4 pb-5 h-[340px]">
                    <div className="flex items-center gap-2.5 mb-3">
                      {companyLogo ? (
                        <img src={companyLogo} alt="Logo" className="h-11 w-11 object-contain bg-white p-0.5 rounded" />
                      ) : (
                        <div className="h-11 w-11 rounded bg-white flex items-center justify-center text-[#ef7a1a] font-extrabold text-xl">{companyName[0]}</div>
                      )}
                      <div className="leading-none">
                        <div className="text-[22px] font-extrabold italic text-black tracking-wide">{companyName}</div>
                      </div>
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
                  {/* White bottom */}
                  <div className="px-3 pt-4 pb-3 text-center">
                    <p className="text-lg font-extrabold text-black">{emp.first_name} {emp.last_name}</p>
                    <p className="text-xs text-neutral-700 mt-0.5">{desigName}</p>
                    <div className="mt-3">
                      <img src={barcodeUrl} alt="Barcode" className="h-[46px] mx-auto" />
                      <p className="text-xs font-bold tracking-wider text-black mt-0.5">{emp.employee_code}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ===== BACK ===== */}
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
                    {!factoryAddr && !headOfficeAddr && contactLines.length > 0 && (
                      <p className="text-[11px] text-center text-black">{contactLines.join(" · ")}</p>
                    )}
                    <div className="mt-auto text-center pt-2">
                      <img src={qrUrl} alt="QR" className="w-[120px] h-[120px] mx-auto" />
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
