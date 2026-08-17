import * as XLSX from "xlsx";

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: "currency" | "date" | "number";
}

export function exportToExcel(
  data: Record<string, any>[],
  columns: ReportColumn[],
  filename: string
) {
  const headers = columns.map((c) => c.label);
  const rows = data.map((row) =>
    columns.map((c) => {
      const val = row[c.key];
      if (c.format === "currency" && typeof val === "number") return val;
      return val ?? "";
    })
  );

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** DD-MM-YYYY, for the meta box (matches the app's date-input convention). */
function formatDmy(d: string | Date): string {
  const date = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** DD-MM-YYYY, H:MM:SS AM/PM — for the "Print Time" field. */
function formatPrintTime(d: Date): string {
  const datePart = formatDmy(d);
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  return `${datePart}, ${timePart}`;
}

export function printReport(
  contentRef: React.RefObject<HTMLDivElement | null>,
  title: string,
  companyName?: string,
  companyInfo?: { address?: string; phone?: string; email?: string },
  meta?: { dateFrom?: string; dateTo?: string; printedUser?: string }
) {
  const content = contentRef.current;
  if (!content) return;
  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) return;

  const metaRows = [
    meta?.dateFrom ? `<p><b>From Date:</b> ${formatDmy(meta.dateFrom)}</p>` : "",
    meta?.dateTo ? `<p><b>To Date:</b> ${formatDmy(meta.dateTo)}</p>` : "",
    `<p><b>Print Time:</b> ${formatPrintTime(new Date())}</p>`,
    meta?.printedUser ? `<p><b>Printed User:</b> ${meta.printedUser}</p>` : "",
  ].filter(Boolean).join("");

  win.document.write(`<!DOCTYPE html><html><head><title>${title} — ${companyName || "Report"}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 12px; color: #1a1a1a; padding: 28px; }
      .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
      .company-info h1 { font-size: 24px; font-weight: 700; }
      .company-info p { font-size: 12px; color: #444; margin-top: 4px; line-height: 1.4; }
      .meta-info { text-align: right; white-space: nowrap; }
      .meta-info p { font-size: 12px; margin-top: 2px; }
      .meta-info b { font-weight: 700; }
      .report-title { text-align: center; font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 18px; }
      .header-rule { border: none; border-top: 3px solid #1a1a1a; margin: 14px 0 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #1a1a1a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
      td { padding: 8px 10px; border-bottom: 1px solid #e5e5e5; font-size: 12px; }
      .text-right, th.text-right, td.text-right { text-align: right; }
      .font-bold, .total-row { font-weight: 700; }
      .total-row td { border-top: 2px solid #1a1a1a; border-bottom: none; }
      .bg-muted\\/50 { background: #f8f8f8; }
      .section-title { font-size: 14px; font-weight: 600; margin: 20px 0 10px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      .summary-card { padding: 12px; background: #f8f8f8; border-radius: 4px; margin: 8px 0; }
      .footer { margin-top: 40px; text-align: center; }
      .footer .system-line { font-size: 11px; font-style: italic; color: #444; }
      .footer .brand-line { font-size: 10px; color: #999; margin-top: 4px; }
      @media print {
        body { padding: 0; }
        @page { margin: 18mm 14mm; }
        @page { @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9px; color: #999; } }
      }
    </style></head><body>
    <div class="header">
      <div class="header-top">
        <div class="company-info">
          <h1>${companyName || "Company"}</h1>
          ${companyInfo?.address ? `<p>${companyInfo.address}</p>` : ""}
          <p>${[companyInfo?.phone && `Phone: ${companyInfo.phone}`, companyInfo?.email && `Email: ${companyInfo.email}`].filter(Boolean).join(" | ")}</p>
        </div>
        <div class="meta-info">${metaRows}</div>
      </div>
      <h2 class="report-title">${title}</h2>
    </div>
    <hr class="header-rule" />
    ${content.innerHTML}
    <div class="footer">
      <p class="system-line">This is a system-generated report.</p>
      <p class="brand-line">Printed From Smart ERP, Developed by Sync &amp; Solutions IT</p>
    </div>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 400);
}

export function exportToPDF(
  contentRef: React.RefObject<HTMLDivElement | null>,
  title: string,
  companyName?: string,
  companyInfo?: { address?: string; phone?: string; email?: string },
  meta?: { dateFrom?: string; dateTo?: string; printedUser?: string }
) {
  // Uses the same print dialog which allows "Save as PDF"
  printReport(contentRef, title, companyName, companyInfo, meta);
}
