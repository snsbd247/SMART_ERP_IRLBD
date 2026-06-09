
-- Purchase Workflow tables: Requisition -> PO -> GRN -> Bill -> Payment

-- 1. Purchase Requisitions
CREATE TABLE public.purchase_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number text NOT NULL UNIQUE,
  pr_date date NOT NULL DEFAULT CURRENT_DATE,
  branch_id uuid,
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  status text NOT NULL DEFAULT 'pending_admin',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requisitions TO authenticated;
GRANT ALL ON public.purchase_requisitions TO service_role;
ALTER TABLE public.purchase_requisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all pr" ON public.purchase_requisitions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.purchase_requisition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id uuid NOT NULL REFERENCES public.purchase_requisitions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  qty_required numeric(15,3) NOT NULL,
  qty_ordered numeric(15,3) NOT NULL DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requisition_items TO authenticated;
GRANT ALL ON public.purchase_requisition_items TO service_role;
ALTER TABLE public.purchase_requisition_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all pri" ON public.purchase_requisition_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Purchase Orders v2
CREATE TABLE public.purchase_orders_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  po_date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_id uuid NOT NULL,
  pr_id uuid REFERENCES public.purchase_requisitions(id) ON DELETE SET NULL,
  branch_id uuid,
  subtotal numeric(15,2) NOT NULL DEFAULT 0,
  vat_amount numeric(15,2) NOT NULL DEFAULT 0,
  grand_total numeric(15,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders_v2 TO authenticated;
GRANT ALL ON public.purchase_orders_v2 TO service_role;
ALTER TABLE public.purchase_orders_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all pov2" ON public.purchase_orders_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.purchase_order_items_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders_v2(id) ON DELETE CASCADE,
  pr_item_id uuid REFERENCES public.purchase_requisition_items(id) ON DELETE SET NULL,
  product_id uuid NOT NULL,
  qty_ordered numeric(15,3) NOT NULL,
  qty_received numeric(15,3) NOT NULL DEFAULT 0,
  rate numeric(15,2) NOT NULL DEFAULT 0,
  vat_pct numeric(5,2) NOT NULL DEFAULT 0,
  line_total numeric(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items_v2 TO authenticated;
GRANT ALL ON public.purchase_order_items_v2 TO service_role;
ALTER TABLE public.purchase_order_items_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all poiv2" ON public.purchase_order_items_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. GRN
CREATE TABLE public.grns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text NOT NULL UNIQUE,
  grn_date date NOT NULL DEFAULT CURRENT_DATE,
  po_id uuid NOT NULL REFERENCES public.purchase_orders_v2(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL,
  supplier_invoice_no text,
  supplier_invoice_date date,
  branch_id uuid,
  received_by uuid,
  total_amount numeric(15,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'posted',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grns TO authenticated;
GRANT ALL ON public.grns TO service_role;
ALTER TABLE public.grns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all grns" ON public.grns FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.grn_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.grns(id) ON DELETE CASCADE,
  po_item_id uuid NOT NULL REFERENCES public.purchase_order_items_v2(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  qty_received numeric(15,3) NOT NULL,
  rate numeric(15,2) NOT NULL DEFAULT 0,
  line_total numeric(15,2) NOT NULL DEFAULT 0,
  qty_billed numeric(15,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grn_items TO authenticated;
GRANT ALL ON public.grn_items TO service_role;
ALTER TABLE public.grn_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all grni" ON public.grn_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Purchase Bills
CREATE TABLE public.purchase_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number text NOT NULL UNIQUE,
  bill_date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_id uuid NOT NULL,
  supplier_bill_no text,
  due_date date,
  branch_id uuid,
  subtotal numeric(15,2) NOT NULL DEFAULT 0,
  vat_amount numeric(15,2) NOT NULL DEFAULT 0,
  grand_total numeric(15,2) NOT NULL DEFAULT 0,
  paid_amount numeric(15,2) NOT NULL DEFAULT 0,
  tds_amount numeric(15,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid',
  voucher_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_bills TO authenticated;
GRANT ALL ON public.purchase_bills TO service_role;
ALTER TABLE public.purchase_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all pbill" ON public.purchase_bills FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.purchase_bill_grns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.purchase_bills(id) ON DELETE CASCADE,
  grn_id uuid NOT NULL REFERENCES public.grns(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bill_id, grn_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_bill_grns TO authenticated;
GRANT ALL ON public.purchase_bill_grns TO service_role;
ALTER TABLE public.purchase_bill_grns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all pbg" ON public.purchase_bill_grns FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.purchase_bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text NOT NULL UNIQUE,
  bill_id uuid NOT NULL REFERENCES public.purchase_bills(id) ON DELETE RESTRICT,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(15,2) NOT NULL,
  tds_amount numeric(15,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  bank_account_id uuid,
  reference_no text,
  voucher_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_bill_payments TO authenticated;
GRANT ALL ON public.purchase_bill_payments TO service_role;
ALTER TABLE public.purchase_bill_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all pbp" ON public.purchase_bill_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_pri_pr ON public.purchase_requisition_items(pr_id);
CREATE INDEX idx_poiv2_po ON public.purchase_order_items_v2(po_id);
CREATE INDEX idx_poiv2_pri ON public.purchase_order_items_v2(pr_item_id);
CREATE INDEX idx_grns_po ON public.grns(po_id);
CREATE INDEX idx_grni_grn ON public.grn_items(grn_id);
CREATE INDEX idx_grni_poi ON public.grn_items(po_item_id);
CREATE INDEX idx_pbg_bill ON public.purchase_bill_grns(bill_id);
CREATE INDEX idx_pbp_bill ON public.purchase_bill_payments(bill_id);
