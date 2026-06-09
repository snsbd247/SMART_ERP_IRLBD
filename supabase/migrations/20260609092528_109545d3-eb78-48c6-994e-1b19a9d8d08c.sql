
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
CREATE INDEX idx_po_status   ON public.purchase_orders(status);
CREATE INDEX idx_po_date     ON public.purchase_orders(po_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage purchase_orders" ON public.purchase_orders
  FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Authenticated read purchase_orders" ON public.purchase_orders
  FOR SELECT TO authenticated USING (true);

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
CREATE INDEX idx_poi_po      ON public.purchase_order_items(po_id);
CREATE INDEX idx_poi_product ON public.purchase_order_items(product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage purchase_order_items" ON public.purchase_order_items
  FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Authenticated read purchase_order_items" ON public.purchase_order_items
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.po_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  amended_by uuid,
  old_data jsonb,
  new_data jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_amendments TO authenticated;
GRANT ALL ON public.po_amendments TO service_role;
ALTER TABLE public.po_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage po_amendments" ON public.po_amendments
  FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Authenticated read po_amendments" ON public.po_amendments
  FOR SELECT TO authenticated USING (true);

-- Re-add FK from dispatch_po_allocations (was cascade-dropped)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='dispatch_po_allocations') THEN
    ALTER TABLE public.dispatch_po_allocations
      ADD CONSTRAINT dispatch_po_allocations_po_item_id_fkey
      FOREIGN KEY (po_item_id) REFERENCES public.purchase_order_items(id);
  END IF;
END $$;

-- Restore sales-side PO number sequence
INSERT INTO public.number_sequences (id, prefix, current_number, year, description) VALUES
  ('purchase_order', 'PO', 0, EXTRACT(year FROM CURRENT_DATE)::int, 'Customer Purchase Order')
ON CONFLICT (id) DO NOTHING;
