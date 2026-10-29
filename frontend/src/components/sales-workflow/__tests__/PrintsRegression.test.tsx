/**
 * Regression: ensure the Mushak 6.3 overhaul did NOT affect the other prints.
 * Each print renders its trigger button with unchanged sample data; no crash
 * and the expected label/heading must still appear.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock provider-dependent modules (alias + relative variants for vitest resolver)
const settingsStub = { settings: { company_name: "Test Co", bin_number: "000000001-0001", address: "Dhaka" }, loading: false, refetch: () => {} };
vi.mock("@/hooks/useCompanySettings", () => ({ useCompanySettings: () => settingsStub }));
vi.mock("../../../hooks/useCompanySettings", () => ({ useCompanySettings: () => settingsStub }));
vi.mock("@/contexts/CurrencyContext", () => ({ useCurrency: () => ({ refetch: () => {} }) }));
vi.mock("../../../contexts/CurrencyContext", () => ({ useCurrency: () => ({ refetch: () => {} }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("../../../hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/integrations/data/client", () => ({ dataClient: { functions: { invoke: async () => ({ data: null, error: null }) } } }));
vi.mock("../../../integrations/data/client", () => ({ dataClient: { functions: { invoke: async () => ({ data: null, error: null }) } } }));
import {
  PrintPO,
  PrintTaxInvoice,
  PrintDeliveryChallan,
  PrintMoneyReceipt,
  PrintVatChallan,
} from "../SalesWorkflowPrints";

const PO = {
  po_number: "PO-001", po_date: "2026-06-01",
  customer: { name: "Acme", email: "a@a.com" },
  subtotal: 100, vat_amount: 15, grand_total: 115,
  items: [{ id: 1, product: { name: "Widget" }, qty_ordered: 10, rate: 10, vat_pct: 15, line_total: 115 }],
};
const INV = {
  invoice_number: "INV-001", invoice_date: "2026-06-01",
  customer: { name: "Acme" },
  subtotal: 100, vat_total: 15, grand_total: 115, paid_amount: 0, tds_amount: 0, due_amount: 115,
  items: [{ id: 1, product: { name: "Widget" }, qty: 10, rate: 10, vat_pct: 15, vat_amount: 15, line_total: 115 }],
};
const DC = { dc_number: "DC-001", dc_date: "2026-06-01", customer: { name: "Acme" }, product: { name: "Widget" }, qty: 10, vat_challan: { challan_number: "VC-1" }, status: "delivered" };
const PAY = { payment_number: "PAY-1", payment_date: "2026-06-01", mode: "cash", reference: null, amount_received: 100, tds_amount: 0, total_settled: 100 };
const VC = { challan_number: "VC-1", challan_date: "2026-06-01", customer: { name: "Acme", bin_number: "000000001-0001" }, items: [{ id: 1, product: { name: "Widget", unit: "PCS" }, qty: 1, rate: 100, vat_pct: 15, vat_amount: 15, line_total: 115 }], subtotal: 100, vat_amount: 15, grand_total: 115 };

describe("Sales workflow prints — regression after Mushak 6.3 overhaul", () => {
  it("PrintPO renders trigger without crash", () => {
    const { getByText } = render(<PrintPO po={PO} />);
    expect(getByText(/Print/i)).toBeTruthy();
  });
  it("PrintTaxInvoice renders trigger without crash", () => {
    const { getByText } = render(<PrintTaxInvoice inv={INV} />);
    expect(getByText(/Print Invoice/i)).toBeTruthy();
  });
  it("PrintDeliveryChallan renders trigger without crash", () => {
    const { getByText } = render(<PrintDeliveryChallan dc={DC} />);
    expect(getByText(/Print/i)).toBeTruthy();
  });
  it("PrintMoneyReceipt renders trigger without crash", () => {
    const { getByText } = render(<PrintMoneyReceipt payment={PAY} invoice={INV} />);
    expect(getByText(/Receipt/i)).toBeTruthy();
  });
  it("PrintVatChallan (Mushak 6.3) renders trigger without crash", () => {
    const { getByText } = render(<PrintVatChallan v={VC} />);
    expect(getByText(/Print Mushak 6\.3/i)).toBeTruthy();
  });
});
