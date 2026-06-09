
CREATE TABLE public.purchase_returns_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL UNIQUE,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id UUID,
  grn_id UUID,
  bill_id UUID,
  branch_id UUID,
  warehouse_id UUID,
  reason TEXT,
  subtotal NUMERIC(18,2) DEFAULT 0,
  vat_amount NUMERIC(18,2) DEFAULT 0,
  grand_total NUMERIC(18,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  voucher_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_returns_v2 TO authenticated;
GRANT ALL ON public.purchase_returns_v2 TO service_role;
ALTER TABLE public.purchase_returns_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage purchase_returns_v2" ON public.purchase_returns_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_purchase_returns_v2_uat BEFORE UPDATE ON public.purchase_returns_v2 FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.purchase_return_items_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.purchase_returns_v2(id) ON DELETE CASCADE,
  item_id UUID,
  grn_item_id UUID,
  description TEXT,
  quantity NUMERIC(18,4) DEFAULT 0,
  unit_cost NUMERIC(18,4) DEFAULT 0,
  vat_rate NUMERIC(8,4) DEFAULT 0,
  line_total NUMERIC(18,2) DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_return_items_v2 TO authenticated;
GRANT ALL ON public.purchase_return_items_v2 TO service_role;
ALTER TABLE public.purchase_return_items_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage purchase_return_items_v2" ON public.purchase_return_items_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_pr_v2_supplier ON public.purchase_returns_v2(supplier_id);
CREATE INDEX idx_pri_v2_return ON public.purchase_return_items_v2(return_id);
