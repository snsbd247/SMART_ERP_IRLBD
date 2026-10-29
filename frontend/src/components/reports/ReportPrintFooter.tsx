/**
 * Standard print/PDF footer — shown only when printing (hidden on screen).
 * Add once per printable report; the page number comes from the browser's
 * own print pagination (see the `@page` counter rule in index.css).
 */
export function ReportPrintFooter() {
  return (
    <div className="hidden print:block mt-10 text-center">
      <p className="text-[11px] italic text-muted-foreground">This is a system-generated report.</p>
      <p className="text-[10px] text-muted-foreground/70 mt-1">Printed From Smart ERP, Developed by Sync &amp; Solutions IT</p>
    </div>
  );
}
