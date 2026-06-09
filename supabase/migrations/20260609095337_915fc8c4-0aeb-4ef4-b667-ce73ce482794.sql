
-- ============================================================
-- PHASE 2: PURCHASE REQUISITION + PURCHASE ORDER
-- ============================================================

-- 1. Purchase Requisitions (header)
CREATE TABLE public.purchase_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_no text NOT NULL UNIQUE,
  pr_date date NOT NULL DEFAULT CURRENT_DATE,
  required_date date,
  purchase_type_id uuid REFERENCES public.purchase_types(id),
  branch_id uuid REFERENCES public.branches(id),
  department_id uuid REFERENCES public.departments(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  requested_by uuid,
  requested_by_name text,
  priority text NOT NULL DEFAULT 'normal', -- low, normal, high, urgent
  status text NOT NULL DEFAULT 'draft', -- draft, submitted, approved, rejected, partial_approved, closed, cancelled
  total_estimated numeric(18,2) NOT NULL DEFAULT 0,
  remarks text,
  rejected_reason text,
  closed_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pr_status ON public.purchase_requisitions(status);
CREATE INDEX idx_pr_branch ON public.purchase_requisitions(branch_id);
CREATE INDEX idx_pr_date ON public.purchase_requisitions(pr_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requisitions TO authenticated;
GRANT ALL ON public.purchase_requisitions TO service_role;
ALTER TABLE public.purchase_requisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr_auth_all" ON public.purchase_requisitions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Purchase Requisition Items
CREATE TABLE public.purchase_requisition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id uuid NOT NULL REFERENCES public.purchase_requisitions(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  item_id uuid REFERENCES public.item_master(id),
  item_description text NOT NULL,
  unit_id uuid REFERENCES public.units(id),
  quantity numeric(18,3) NOT NULL DEFAULT 0,
  estimated_price numeric(18,4) NOT NULL DEFAULT 0,
  estimated_amount numeric(18,2) NOT NULL DEFAULT 0,
  ordered_qty numeric(18,3) NOT NULL DEFAULT 0,
  remarks text,
  status text NOT NULL DEFAULT 'pending', -- pending, approved, rejected, ordered, closed
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pri_pr ON public.purchase_requisition_items(pr_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requisition_items TO authenticated;
GRANT ALL ON public.purchase_requisition_items TO service_role;
ALTER TABLE public.purchase_requisition_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pri_auth_all" ON public.purchase_requisition_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Purchase Orders v2 (procurement-side, separate from sales-side purchase_orders)
CREATE TABLE public.purchase_orders_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no text NOT NULL UNIQUE,
  po_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_date date,
  purchase_type_id uuid REFERENCES public.purchase_types(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  branch_id uuid REFERENCES public.branches(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  currency text DEFAULT 'BDT',
  exchange_rate numeric(18,6) NOT NULL DEFAULT 1,
  payment_terms text,
  delivery_terms text,
  shipping_address text,
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  freight_amount numeric(18,2) NOT NULL DEFAULT 0,
  vat_amount numeric(18,2) NOT NULL DEFAULT 0,
  ait_amount numeric(18,2) NOT NULL DEFAULT 0,
  other_charges numeric(18,2) NOT NULL DEFAULT 0,
  grand_total numeric(18,2) NOT NULL DEFAULT 0,
  received_total numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft', -- draft, pending_approval, approved, cancelled, partially_received, closed
  revision_no integer NOT NULL DEFAULT 0,
  remarks text,
  cancelled_reason text,
  closed_reason text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_po2_supplier ON public.purchase_orders_v2(supplier_id);
CREATE INDEX idx_po2_status ON public.purchase_orders_v2(status);
CREATE INDEX idx_po2_date ON public.purchase_orders_v2(po_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders_v2 TO authenticated;
GRANT ALL ON public.purchase_orders_v2 TO service_role;
ALTER TABLE public.purchase_orders_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po2_auth_all" ON public.purchase_orders_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Purchase Order Items v2
CREATE TABLE public.purchase_order_items_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders_v2(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  item_id uuid REFERENCES public.item_master(id),
  item_description text NOT NULL,
  unit_id uuid REFERENCES public.units(id),
  quantity numeric(18,3) NOT NULL DEFAULT 0,
  unit_price numeric(18,4) NOT NULL DEFAULT 0,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  vat_percent numeric(5,2) NOT NULL DEFAULT 0,
  ait_percent numeric(5,2) NOT NULL DEFAULT 0,
  line_total numeric(18,2) NOT NULL DEFAULT 0,
  received_qty numeric(18,3) NOT NULL DEFAULT 0,
  billed_qty numeric(18,3) NOT NULL DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_poi2_po ON public.purchase_order_items_v2(po_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items_v2 TO authenticated;
GRANT ALL ON public.purchase_order_items_v2 TO service_role;
ALTER TABLE public.purchase_order_items_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "poi2_auth_all" ON public.purchase_order_items_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. PR ↔ PO linkage (many-to-many)
CREATE TABLE public.po_pr_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_item_id uuid NOT NULL REFERENCES public.purchase_order_items_v2(id) ON DELETE CASCADE,
  pr_item_id uuid NOT NULL REFERENCES public.purchase_requisition_items(id) ON DELETE CASCADE,
  linked_qty numeric(18,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(po_item_id, pr_item_id)
);
CREATE INDEX idx_popr_po ON public.po_pr_links(po_item_id);
CREATE INDEX idx_popr_pr ON public.po_pr_links(pr_item_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_pr_links TO authenticated;
GRANT ALL ON public.po_pr_links TO service_role;
ALTER TABLE public.po_pr_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "popr_auth_all" ON public.po_pr_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. PO Amendments v2
CREATE TABLE public.po_amendments_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders_v2(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  amended_by uuid,
  amended_by_name text,
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_poa2_po ON public.po_amendments_v2(po_id);
GRANT SELECT, INSERT ON public.po_amendments_v2 TO authenticated;
GRANT ALL ON public.po_amendments_v2 TO service_role;
ALTER TABLE public.po_amendments_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "poa2_read" ON public.po_amendments_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "poa2_ins" ON public.po_amendments_v2 FOR INSERT TO authenticated WITH CHECK (true);

-- updated_at triggers
CREATE TRIGGER trg_pr_uat BEFORE UPDATE ON public.purchase_requisitions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_po2_uat BEFORE UPDATE ON public.purchase_orders_v2 FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
