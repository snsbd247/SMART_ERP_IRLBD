
-- ============================================================
-- PHASE 1: Bangladesh VAT Sales Workflow Tables
-- All additive. No existing table modified.
-- ============================================================

-- 1. PURCHASE ORDERS
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  po_date date NOT NULL DEFAULT CURRENT_DATE,
  customer_id uuid NOT NULL,
  delivery_date date,
  status text NOT NULL DEFAULT 'open',
  subtotal numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  notes text,
  attachment_url text,
  branch_id uuid,
  financial_year_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_po_customer ON public.purchase_orders(customer_id);
CREATE INDEX idx_po_status ON public.purchase_orders(status);
CREATE INDEX idx_po_date ON public.purchase_orders(po_date);

CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  qty_ordered numeric NOT NULL DEFAULT 0,
  qty_delivered numeric NOT NULL DEFAULT 0,
  qty_remaining numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  vat_pct numeric NOT NULL DEFAULT 0,
  line_subtotal numeric NOT NULL DEFAULT 0,
  line_vat numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX idx_poi_po ON public.purchase_order_items(po_id);
CREATE INDEX idx_poi_product ON public.purchase_order_items(product_id);

CREATE TABLE public.po_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  amended_by uuid,
  old_data jsonb,
  new_data jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. DISPATCH
CREATE TABLE public.dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_number text NOT NULL UNIQUE,
  dispatch_date date NOT NULL DEFAULT CURRENT_DATE,
  customer_id uuid NOT NULL,
  vehicle_no text,
  driver_name text,
  driver_phone text,
  status text NOT NULL DEFAULT 'draft',
  total_qty numeric NOT NULL DEFAULT 0,
  notes text,
  branch_id uuid,
  financial_year_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_dispatch_customer ON public.dispatches(customer_id);
CREATE INDEX idx_dispatch_status ON public.dispatches(status);

CREATE TABLE public.dispatch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.dispatches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX idx_di_dispatch ON public.dispatch_items(dispatch_id);

CREATE TABLE public.dispatch_po_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_item_id uuid NOT NULL REFERENCES public.dispatch_items(id) ON DELETE CASCADE,
  po_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id),
  po_id uuid NOT NULL,
  allocated_qty numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dpa_dispatch_item ON public.dispatch_po_allocations(dispatch_item_id);
CREATE INDEX idx_dpa_po_item ON public.dispatch_po_allocations(po_item_id);

-- 3. VAT CHALLAN
CREATE TABLE public.vat_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_number text NOT NULL UNIQUE,
  challan_date date NOT NULL DEFAULT CURRENT_DATE,
  customer_id uuid NOT NULL,
  dispatch_id uuid REFERENCES public.dispatches(id),
  vehicle_no text,
  driver_name text,
  subtotal numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'issued',
  attachment_url text,
  notes text,
  branch_id uuid,
  financial_year_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_vc_customer ON public.vat_challans(customer_id);
CREATE INDEX idx_vc_date ON public.vat_challans(challan_date);
CREATE INDEX idx_vc_status ON public.vat_challans(status);

CREATE TABLE public.vat_challan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vat_challan_id uuid NOT NULL REFERENCES public.vat_challans(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  vat_pct numeric NOT NULL DEFAULT 0,
  line_subtotal numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX idx_vci_challan ON public.vat_challan_items(vat_challan_id);

-- 4. DELIVERY CHALLAN (one per product per VAT challan)
CREATE TABLE public.delivery_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dc_number text NOT NULL UNIQUE,
  dc_date date NOT NULL DEFAULT CURRENT_DATE,
  vat_challan_id uuid NOT NULL REFERENCES public.vat_challans(id) ON DELETE CASCADE,
  vat_challan_item_id uuid NOT NULL REFERENCES public.vat_challan_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  customer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'issued',
  attachment_url text,
  branch_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dc_vat_challan ON public.delivery_challans(vat_challan_id);
CREATE INDEX idx_dc_status ON public.delivery_challans(status);
CREATE INDEX idx_dc_customer ON public.delivery_challans(customer_id);

-- 5. CUSTOMER RECEIVE
CREATE TABLE public.customer_receives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_challan_id uuid NOT NULL REFERENCES public.delivery_challans(id) ON DELETE CASCADE,
  receive_date date NOT NULL DEFAULT CURRENT_DATE,
  received_by_name text,
  transport_info text,
  scan_url text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cr_dc ON public.customer_receives(delivery_challan_id);

-- 6. HO RECEIVE
CREATE TABLE public.ho_receives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_challan_id uuid NOT NULL REFERENCES public.delivery_challans(id) ON DELETE CASCADE,
  ho_receive_date date NOT NULL DEFAULT CURRENT_DATE,
  verified_by uuid,
  missing_flag boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ho_dc ON public.ho_receives(delivery_challan_id);

-- 7. INVOICE V2 (parallel to existing sales_invoices)
CREATE TABLE public.sales_invoices_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  customer_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'single',
  subtotal numeric NOT NULL DEFAULT 0,
  vat_total numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  tds_amount numeric NOT NULL DEFAULT 0,
  due_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  voucher_id uuid REFERENCES public.acc_vouchers(id),
  notes text,
  branch_id uuid,
  financial_year_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_inv2_customer ON public.sales_invoices_v2(customer_id);
CREATE INDEX idx_inv2_date ON public.sales_invoices_v2(invoice_date);
CREATE INDEX idx_inv2_status ON public.sales_invoices_v2(status);

CREATE TABLE public.sales_invoice_items_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices_v2(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  vat_pct numeric NOT NULL DEFAULT 0,
  line_subtotal numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  source_vat_challan_item_id uuid REFERENCES public.vat_challan_items(id),
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX idx_inv2i_invoice ON public.sales_invoice_items_v2(invoice_id);

CREATE TABLE public.invoice_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices_v2(id) ON DELETE CASCADE,
  vat_challan_id uuid NOT NULL REFERENCES public.vat_challans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_id, vat_challan_id)
);
CREATE INDEX idx_ic_invoice ON public.invoice_challans(invoice_id);
CREATE INDEX idx_ic_vat ON public.invoice_challans(vat_challan_id);

-- 8. PAYMENT
CREATE TABLE public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices_v2(id),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  mode text NOT NULL DEFAULT 'bank',
  amount_received numeric NOT NULL DEFAULT 0,
  tds_amount numeric NOT NULL DEFAULT 0,
  total_settled numeric NOT NULL DEFAULT 0,
  bank_account_id uuid,
  reference text,
  voucher_id uuid REFERENCES public.acc_vouchers(id),
  notes text,
  branch_id uuid,
  financial_year_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ip_invoice ON public.invoice_payments(invoice_id);
CREATE INDEX idx_ip_date ON public.invoice_payments(payment_date);

-- 9. TDS
CREATE TABLE public.tds_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices_v2(id),
  payment_id uuid REFERENCES public.invoice_payments(id),
  tds_pct numeric NOT NULL DEFAULT 0,
  tds_amount numeric NOT NULL DEFAULT 0,
  certificate_no text,
  certificate_date date,
  voucher_id uuid REFERENCES public.acc_vouchers(id),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tds_invoice ON public.tds_entries(invoice_id);

-- 10. STATUS LOGS
CREATE TABLE public.invoice_status_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices_v2(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_isl_invoice ON public.invoice_status_logs(invoice_id);

CREATE TABLE public.dispatch_status_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.dispatches(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dsl_dispatch ON public.dispatch_status_logs(dispatch_id);

-- ============================================================
-- RLS: Super Admin manage all; authenticated SELECT (mirrors project pattern)
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'purchase_orders','purchase_order_items','po_amendments',
    'dispatches','dispatch_items','dispatch_po_allocations',
    'vat_challans','vat_challan_items',
    'delivery_challans','customer_receives','ho_receives',
    'sales_invoices_v2','sales_invoice_items_v2','invoice_challans',
    'invoice_payments','tds_entries',
    'invoice_status_logs','dispatch_status_logs'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Super admins manage %I" ON public.%I FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY "Authenticated read %I" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
  END LOOP;
END $$;

-- ============================================================
-- Seed number sequences for new document types
-- ============================================================
INSERT INTO public.number_sequences (id, prefix, current_number, year, description) VALUES
  ('purchase_order', 'PO',   0, EXTRACT(year FROM CURRENT_DATE)::int, 'Customer Purchase Order'),
  ('dispatch',       'DSP',  0, EXTRACT(year FROM CURRENT_DATE)::int, 'Dispatch / Gate Pass'),
  ('vat_challan',    'VCH',  0, EXTRACT(year FROM CURRENT_DATE)::int, 'VAT Challan (Mushak 6.3)'),
  ('delivery_challan','DC',  0, EXTRACT(year FROM CURRENT_DATE)::int, 'Delivery Challan'),
  ('sales_invoice_v2','INV', 0, EXTRACT(year FROM CURRENT_DATE)::int, 'Consolidated Sales Invoice'),
  ('invoice_payment','RCP',  0, EXTRACT(year FROM CURRENT_DATE)::int, 'Invoice Payment Receipt'),
  ('tds_entry',      'TDS',  0, EXTRACT(year FROM CURRENT_DATE)::int, 'TDS Entry')
ON CONFLICT (id) DO NOTHING;
