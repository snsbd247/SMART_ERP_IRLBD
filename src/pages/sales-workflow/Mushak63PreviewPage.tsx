import { PrintMushak63, Mushak63Body, MushakStyles } from "@/components/sales-workflow/Mushak63Print";

/**
 * Mock-data preview for visual QA — renders the Mushak 6.3 body inline
 * plus a Print/PDF button to verify output.
 * Route: /sales-workflow/vat-challan/preview
 */
const MOCK_CHALLAN = {
  challan_number: "IRL-2025-2026-001591",
  challan_date: "2026-06-08",
  created_at: "2026-06-08T18:26:02",
  vehicle_no: "Dhaka-Metro-AU-11-3129",
  customer: {
    name: "Marico Bangladesh Limited",
    bin_number: "000000539-0003",
    address: "Mouchak, Shafipur; Kaliakair PS; Gazipur-1702; Bangladesh",
  },
  delivery_destination: "Mouchak, Shafipur; Kaliakair PS; Gazipur-1702; Bangladesh",
  items: [
    { id: 1, product: { name: "80ml Cap-Nourishing care-Green", unit: "PCS" }, qty: 19000, rate: 1.03, vat_pct: 15, vat_amount: 2935.5, line_total: 22505.5 },
    { id: 2, product: { name: "80ml Disc-Nourishing care-Green", unit: "PCS" }, qty: 19000, rate: 0.84, vat_pct: 15, vat_amount: 2394, line_total: 18354 },
  ],
};

export default function Mushak63PreviewPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Mushak 6.3 — Mock Preview</h1>
          <p className="text-sm text-muted-foreground">Inline preview matches print/PDF output 1:1.</p>
        </div>
        <PrintMushak63 v={MOCK_CHALLAN} />
      </div>

      <MushakStyles />
      <div
        className="bg-white shadow-lg mx-auto"
        style={{ width: "210mm", padding: "8mm 10mm", color: "#000" }}
      >
        <Mushak63Body v={MOCK_CHALLAN} />
      </div>
    </div>
  );
}
