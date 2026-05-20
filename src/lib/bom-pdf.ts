import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface BomPdfItem {
  code: string;
  name: string;
  unit: string;
  required_qty: number;
  wastage_pct: number;
  wastage_qty: number;
  actual_qty: number;
  unit_price: number;
  total: number;
}

export interface BomPdfExpense {
  code: string;
  name: string;
  rate: number;
}

export interface BomPdfData {
  bom_number: string;
  product_name: string;
  uom: string;
  previous_rate: number;
  current_rate: number;
  notes?: string | null;
  items: BomPdfItem[];
  expenses: BomPdfExpense[];
  company_name?: string;
}

const fmt = (n: number, d = 4) => (Number.isFinite(n) ? n : 0).toFixed(d);

export function generateBomPdf(data: BomPdfData, mode: "open" | "save" = "open") {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(data.company_name || "Bill of Materials", pageW / 2, 36, { align: "center" });
  doc.setFontSize(11);
  doc.text("Bill of Materials", pageW / 2, 54, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  autoTable(doc, {
    startY: 70,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3 },
    body: [
      ["BOM SL:", data.bom_number, "UOM:", data.uom],
      ["Finished Product:", data.product_name, "Previous Rate:", fmt(data.previous_rate)],
      ["Current Rate:", fmt(data.current_rate), "Notes:", data.notes || "—"],
    ],
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 100 },
      1: { cellWidth: 280 },
      2: { fontStyle: "bold", cellWidth: 90 },
      3: { cellWidth: "auto" },
    },
  });

  const itemsTotal = data.items.reduce((s, i) => s + i.total, 0);
  const reqTotal = data.items.reduce((s, i) => s + i.required_qty, 0);
  const wTotal = data.items.reduce((s, i) => s + i.wastage_qty, 0);
  const aTotal = data.items.reduce((s, i) => s + i.actual_qty, 0);

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 14,
    head: [["#", "RM/PM Code", "RM/PM Name", "UOM", "Required QTY", "Wastage %", "Wastage QTY", "Actual QTY", "Unit Price", "Total Amount"]],
    body: data.items.map((i, idx) => [
      idx + 1, i.code, i.name, i.unit,
      fmt(i.required_qty), fmt(i.wastage_pct, 2), fmt(i.wastage_qty),
      fmt(i.actual_qty), fmt(i.unit_price), fmt(i.total),
    ]),
    foot: [["", "", "", "Total", fmt(reqTotal), "", fmt(wTotal), fmt(aTotal), "", fmt(itemsTotal)]],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [60, 60, 60], halign: "center" },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
    columnStyles: {
      0: { halign: "center", cellWidth: 24 },
      4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" },
      7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" },
    },
  });

  const expTotal = data.expenses.reduce((s, e) => s + e.rate, 0);
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 14,
    head: [["EXP Code", "Expense Name", "Rate"]],
    body: data.expenses.length
      ? data.expenses.map((e) => [e.code, e.name, fmt(e.rate)])
      : [["—", "No expenses", "0.0000"]],
    foot: [["", "Total", fmt(expTotal)]],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [60, 60, 60] },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" } },
    tableWidth: 360,
  });

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 14,
    body: [
      ["RM/PM Total", fmt(itemsTotal)],
      ["Expenses Total", fmt(expTotal)],
      ["Current Rate (per unit)", fmt(data.current_rate)],
    ],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 180 },
      1: { halign: "right", cellWidth: 120 },
    },
    tableWidth: 300,
    margin: { left: pageW - 320 },
  });

  const filename = `${data.bom_number || "BOM"}.pdf`;
  if (mode === "save") {
    doc.save(filename);
  } else {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) doc.save(filename);
  }
}
