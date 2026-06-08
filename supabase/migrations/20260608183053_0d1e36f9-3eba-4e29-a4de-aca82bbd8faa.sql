
-- Link VAT Challans to Purchase Orders for partial multi-challan support
ALTER TABLE public.vat_challans
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vat_challans_purchase_order_id ON public.vat_challans(purchase_order_id);

ALTER TABLE public.vat_challan_items
  ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid REFERENCES public.purchase_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS po_qty_consumed numeric(18,3) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_vat_challan_items_po_item_id ON public.vat_challan_items(purchase_order_item_id);
