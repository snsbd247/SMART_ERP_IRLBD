
CREATE TABLE public.grns_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_no text NOT NULL UNIQUE,
  grn_date date NOT NULL DEFAULT CURRENT_DATE,
  po_id uuid REFERENCES public.purchase_orders_v2(id) ON DELETE SET NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  branch_id uuid REFERENCES public.branches(id),
  warehouse_id uuid REFERENCES public.warehouses(id),
  challan_no text,
  challan_date date,
  vehicle_no text,
  received_by_name text,
  inspected_by_name text,
  subtotal numeric NOT NULL DEFAULT 0,
  freight_amount numeric NOT NULL DEFAULT 0,
  other_charges numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Draft',
  auto_post boolean NOT NULL DEFAULT true,
  voucher_id uuid REFERENCES public.acc_vouchers(id),
  remarks text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.grn_items_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.grns_v2(id) ON DELETE CASCADE,
  po_item_id uuid REFERENCES public.purchase_order_items_v2(id) ON DELETE SET NULL,
  line_no integer NOT NULL,
  item_id uuid REFERENCES public.item_master(id),
  item_description text NOT NULL,
  unit_id uuid REFERENCES public.units(id),
  ordered_qty numeric NOT NULL DEFAULT 0,
  received_qty numeric NOT NULL DEFAULT 0,
  accepted_qty numeric NOT NULL DEFAULT 0,
  rejected_qty numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  line_value numeric NOT NULL DEFAULT 0,
  batch_no text,
  expiry_date date,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grns_v2 TO authenticated;
GRANT ALL ON public.grns_v2 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grn_items_v2 TO authenticated;
GRANT ALL ON public.grn_items_v2 TO service_role;

ALTER TABLE public.grns_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grn_items_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grns_v2 auth all" ON public.grns_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "grn_items_v2 auth all" ON public.grn_items_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER grns_v2_touch BEFORE UPDATE ON public.grns_v2 FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_grns_v2_po ON public.grns_v2(po_id);
CREATE INDEX idx_grns_v2_supplier ON public.grns_v2(supplier_id);
CREATE INDEX idx_grn_items_v2_grn ON public.grn_items_v2(grn_id);
CREATE INDEX idx_grn_items_v2_po_item ON public.grn_items_v2(po_item_id);
