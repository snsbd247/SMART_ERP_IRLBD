
-- ============ Phase 4: Billing, Payments, Import/LC ============

CREATE TABLE public.supplier_bills_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no TEXT NOT NULL UNIQUE,
  supplier_invoice_no TEXT,
  bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  supplier_id UUID,
  po_id UUID,
  grn_id UUID,
  branch_id UUID,
  currency TEXT DEFAULT 'BDT',
  exchange_rate NUMERIC(18,6) DEFAULT 1,
  subtotal NUMERIC(18,2) DEFAULT 0,
  discount_amount NUMERIC(18,2) DEFAULT 0,
  vat_amount NUMERIC(18,2) DEFAULT 0,
  ait_amount NUMERIC(18,2) DEFAULT 0,
  other_charges NUMERIC(18,2) DEFAULT 0,
  grand_total NUMERIC(18,2) DEFAULT 0,
  paid_amount NUMERIC(18,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  voucher_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_bills_v2 TO authenticated;
GRANT ALL ON public.supplier_bills_v2 TO service_role;
ALTER TABLE public.supplier_bills_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage supplier_bills_v2" ON public.supplier_bills_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_supplier_bills_v2_uat BEFORE UPDATE ON public.supplier_bills_v2 FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.supplier_bill_items_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.supplier_bills_v2(id) ON DELETE CASCADE,
  item_id UUID,
  description TEXT,
  quantity NUMERIC(18,4) DEFAULT 0,
  unit_price NUMERIC(18,4) DEFAULT 0,
  discount NUMERIC(18,2) DEFAULT 0,
  vat_rate NUMERIC(8,4) DEFAULT 0,
  ait_rate NUMERIC(8,4) DEFAULT 0,
  line_total NUMERIC(18,2) DEFAULT 0,
  grn_item_id UUID,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_bill_items_v2 TO authenticated;
GRANT ALL ON public.supplier_bill_items_v2 TO service_role;
ALTER TABLE public.supplier_bill_items_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage supplier_bill_items_v2" ON public.supplier_bill_items_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.supplier_payments_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no TEXT NOT NULL UNIQUE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id UUID,
  branch_id UUID,
  payment_method TEXT DEFAULT 'cash',
  bank_account_id UUID,
  reference_no TEXT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  allocated_amount NUMERIC(18,2) DEFAULT 0,
  currency TEXT DEFAULT 'BDT',
  exchange_rate NUMERIC(18,6) DEFAULT 1,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  voucher_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payments_v2 TO authenticated;
GRANT ALL ON public.supplier_payments_v2 TO service_role;
ALTER TABLE public.supplier_payments_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage supplier_payments_v2" ON public.supplier_payments_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_supplier_payments_v2_uat BEFORE UPDATE ON public.supplier_payments_v2 FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.supplier_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.supplier_payments_v2(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES public.supplier_bills_v2(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payment_allocations TO authenticated;
GRANT ALL ON public.supplier_payment_allocations TO service_role;
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage supplier_payment_alloc" ON public.supplier_payment_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.lc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lc_no TEXT NOT NULL UNIQUE,
  lc_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  supplier_id UUID,
  branch_id UUID,
  bank_name TEXT,
  bank_account_id UUID,
  lc_type TEXT DEFAULT 'sight',
  currency TEXT DEFAULT 'USD',
  exchange_rate NUMERIC(18,6) DEFAULT 1,
  lc_amount NUMERIC(18,2) DEFAULT 0,
  margin_pct NUMERIC(8,4) DEFAULT 0,
  margin_amount NUMERIC(18,2) DEFAULT 0,
  total_charges NUMERIC(18,2) DEFAULT 0,
  landed_cost NUMERIC(18,2) DEFAULT 0,
  po_id UUID,
  grn_id UUID,
  status TEXT NOT NULL DEFAULT 'opened',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lc_documents TO authenticated;
GRANT ALL ON public.lc_documents TO service_role;
ALTER TABLE public.lc_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage lc_documents" ON public.lc_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_lc_documents_uat BEFORE UPDATE ON public.lc_documents FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.lc_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lc_id UUID NOT NULL REFERENCES public.lc_documents(id) ON DELETE CASCADE,
  charge_type TEXT NOT NULL,
  charge_date DATE DEFAULT CURRENT_DATE,
  description TEXT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'BDT',
  account_id UUID,
  reference_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lc_charges TO authenticated;
GRANT ALL ON public.lc_charges TO service_role;
ALTER TABLE public.lc_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage lc_charges" ON public.lc_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_sb_v2_supplier ON public.supplier_bills_v2(supplier_id);
CREATE INDEX idx_sb_v2_status ON public.supplier_bills_v2(status);
CREATE INDEX idx_sbi_v2_bill ON public.supplier_bill_items_v2(bill_id);
CREATE INDEX idx_sp_v2_supplier ON public.supplier_payments_v2(supplier_id);
CREATE INDEX idx_spa_payment ON public.supplier_payment_allocations(payment_id);
CREATE INDEX idx_spa_bill ON public.supplier_payment_allocations(bill_id);
CREATE INDEX idx_lc_supplier ON public.lc_documents(supplier_id);
CREATE INDEX idx_lc_charges_lc ON public.lc_charges(lc_id);
