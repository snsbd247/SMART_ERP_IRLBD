import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Printer } from "lucide-react";
import type { MoneyReceipt } from "@/lib/money-receipt-api";
import type { CompanySettingsRow } from "@/contexts/CurrencyContext";

type PrintWhich = "both" | "office" | "customer";

const PAYMENT_MODE_LABEL: Record<string, string> = {
  cash: "Cash", cheque: "Cheque No.", po: "P.O", dd: "D.D.",
};

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(d: string): string {
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmount(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}

function copyBlock(receipt: MoneyReceipt, company: CompanySettingsRow | null, qrSvg: string, copyLabel: string): string {
  const paymentLine = receipt.payment_mode === "cash"
    ? "Cash"
    : `${PAYMENT_MODE_LABEL[receipt.payment_mode]} ${esc(receipt.payment_ref_no) || "....................."}`;

  return `
  <div class="copy">
    <div class="header">
      <div class="header-left">
        ${company?.company_logo_url
          ? `<img src="${company.company_logo_url}" class="logo" />`
          : `<div class="company-name">${esc(company?.company_name) || "Company Name"}</div>`}
      </div>
      <div class="header-mid">
        <div class="doc-title">MONEY RECEIPT</div>
        <div class="doc-sub">${copyLabel}</div>
      </div>
      <div class="header-right">
        ${company?.address ? `<div>${esc(company.address)}</div>` : ""}
        ${company?.email ? `<div>E-mail: ${esc(company.email)}</div>` : ""}
      </div>
    </div>

    <div class="no-row">
      <span>Ref No: <span class="no-value">${esc(receipt.receipt_no)}</span></span>
      <span>Date: <span class="no-value">${formatDate(receipt.receipt_date)}</span></span>
    </div>

    <div class="field"><span class="label">Received with thanks from</span><span class="dots">${esc(receipt.received_from)}</span></div>
    <div class="field"><span class="label">Address</span><span class="dots">${esc(receipt.address)}</span></div>
    <div class="field"><span class="label">On account of</span><span class="dots">${esc(receipt.on_account_of)}</span></div>
    <div class="field-row">
      <div class="field field-grow"><span class="label">by</span><span class="dots">${paymentLine}</span></div>
      <div class="field field-date"><span class="label">Dated</span><span class="dots">${formatDate(receipt.receipt_date)}</span></div>
    </div>
    <div class="field-row bill-row">
      <div class="field field-grow"><span class="label">Against Bill No</span><span class="dots dots-2line">${esc(receipt.against_bill_no)}</span></div>
      <div class="field field-date"><span class="label">Bill Dated</span><span class="dots">${receipt.against_bill_date ? formatDate(receipt.against_bill_date) : ""}</span></div>
    </div>

    <div class="blank-line"></div>

    <div class="amount-row">
      <div class="tk-box"><span class="label">Tk.</span><span class="tk-value">${fmtAmount(receipt.amount)}</span></div>
      <div class="field field-grow"><span class="label words-label">(in words)</span><span class="dots">${esc(receipt.amount_in_words)}</span></div>
    </div>

    <div class="footer">
      <div class="footer-note">
        <div class="sig-note">This is a software generated copy, signature not required.</div>
        <div class="footer-brand">Printed From Smart ERP, Developed by Sync &amp; Solutions IT</div>
      </div>
      <div class="qr-block">
        ${qrSvg}
        <div class="qr-label">SCAN TO VERIFY</div>
      </div>
    </div>
  </div>`;
}

function buildHtml(receipt: MoneyReceipt, company: CompanySettingsRow | null, verifyUrl: string, qrSvg: string, which: PrintWhich): string {
  const styles = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1a1a1a; background: #fff; padding: 16px; }
    .copy { position: relative; border: 1.5px solid #1a1a1a; padding: 14px 18px; margin-bottom: 10px; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 10px; gap: 10px; }
    .header-left { display: flex; align-items: center; gap: 8px; }
    .logo { height: 34px; }
    .company-name { font-size: 20px; font-weight: 800; font-style: italic; }
    .header-mid { text-align: center; padding-top: 2px; }
    .doc-title { font-size: 14px; font-weight: 700; }
    .doc-sub { display: inline-block; margin-top: 3px; background: #1a1a1a; color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 10px; border-radius: 3px; }
    .header-right { font-size: 9px; color: #444; max-width: 220px; text-align: right; line-height: 1.4; }
    .no-row { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 10px; }
    .no-value { margin-left: 6px; }
    .field { display: flex; align-items: baseline; font-size: 12px; margin-bottom: 9px; }
    .field-row { display: flex; gap: 24px; }
    .field-grow { flex: 1; }
    .field-date { min-width: 160px; }
    .label { white-space: nowrap; font-style: italic; color: #1a1a1a; margin-right: 6px; }
    .words-label { min-width: 62px; }
    .dots { flex: 1; border-bottom: 1px dotted #444; min-height: 15px; padding-bottom: 1px; font-weight: 600; }
    .blank-line { border-bottom: 1px dotted #444; margin-bottom: 12px; }
    .bill-row { align-items: flex-start; }
    .bill-row .field-date .label { padding-top: 1px; }
    .dots-2line {
      white-space: normal; word-break: break-word; line-height: 17px; min-height: 34px;
      border-bottom: none; padding-bottom: 0;
      background-image: linear-gradient(to bottom, transparent 16px, #444 16px, #444 17px, transparent 17px, transparent 33px, #444 33px, #444 34px);
      background-repeat: no-repeat; background-size: 100% 34px;
    }
    .amount-row { display: flex; align-items: baseline; gap: 14px; margin-top: 4px; margin-bottom: 6px; }
    .tk-box { display: flex; align-items: center; gap: 6px; border: 1px solid #1a1a1a; padding: 3px 10px; background: #f2f2f2; }
    .tk-box .label { font-style: normal; font-weight: 700; }
    .tk-value { font-weight: 700; font-variant-numeric: tabular-nums; }
    .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; }
    .footer-note { flex: 1; text-align: center; }
    .sig-note { font-size: 11px; color: #666; font-style: italic; white-space: nowrap; }
    .footer-brand { font-size: 9px; color: #999; margin-top: 3px; white-space: nowrap; }
    .qr-block { text-align: center; }
    .qr-block svg { width: 64px; height: 64px; }
    .qr-label { font-size: 8px; font-weight: 700; letter-spacing: 0.5px; margin-top: 2px; }
    .cut-line { border-top: 1px dashed #999; margin: 4px 0 12px; position: relative; }
    @page { margin: 0.32in; }
    @media print { body { padding: 0; } .copy { break-inside: avoid; } }
  `;
  const officeBlock = which !== "customer" ? copyBlock(receipt, company, qrSvg, "Office Copy") : "";
  const customerBlock = which !== "office" ? copyBlock(receipt, company, qrSvg, "Customer Copy") : "";
  const cutLine = which === "both" ? `<div class="cut-line"></div>` : "";

  return `<!DOCTYPE html><html><head><title>Money Receipt - ${esc(receipt.receipt_no)}</title><style>${styles}</style></head><body>
    ${officeBlock}
    ${cutLine}
    ${customerBlock}
  </body></html>`;
}

export function MoneyReceiptPrintButton({ receipt, companySettings }: { receipt: MoneyReceipt; companySettings: CompanySettingsRow | null }) {
  const qrHostRef = useRef<HTMLDivElement>(null);
  const verifyUrl = `${window.location.origin}/verify/money-receipt/${receipt.verify_code}`;

  const handlePrint = (which: PrintWhich) => {
    const qrSvg = qrHostRef.current?.querySelector("svg")?.outerHTML || "";
    const html = buildHtml(receipt, companySettings, verifyUrl, qrSvg, which);
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
  };

  return (
    <>
      <div ref={qrHostRef} style={{ position: "fixed", left: -9999, top: -9999 }}>
        <QRCodeSVG value={verifyUrl} size={100} level="M" />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" title="Print">
            <Printer className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handlePrint("both")}>Both Copies</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handlePrint("office")}>Office Copy Only</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handlePrint("customer")}>Customer Copy Only</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
