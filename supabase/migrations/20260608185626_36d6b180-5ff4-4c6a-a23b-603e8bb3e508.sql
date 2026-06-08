DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vat_challans' AND column_name = 'dispatch_id'
  ) THEN
    UPDATE public.vat_challans vc
    SET purchase_order_id = x.po_id,
        source = 'purchase_order'
    FROM (
      SELECT vc_inner.id AS vat_challan_id, MIN(dpa.po_id::text)::uuid AS po_id
      FROM public.vat_challans vc_inner
      JOIN public.dispatch_items di ON di.dispatch_id = vc_inner.dispatch_id
      JOIN public.dispatch_po_allocations dpa ON dpa.dispatch_item_id = di.id
      WHERE vc_inner.purchase_order_id IS NULL
      GROUP BY vc_inner.id
    ) x
    WHERE vc.id = x.vat_challan_id;

    UPDATE public.vat_challan_items vci
    SET purchase_order_item_id = x.po_item_id,
        po_qty_consumed = COALESCE(NULLIF(vci.po_qty_consumed, 0), vci.qty)
    FROM (
      SELECT DISTINCT ON (vci_inner.id)
        vci_inner.id AS vat_challan_item_id,
        dpa.po_item_id
      FROM public.vat_challan_items vci_inner
      JOIN public.vat_challans vc ON vc.id = vci_inner.vat_challan_id
      JOIN public.dispatch_items di ON di.dispatch_id = vc.dispatch_id AND di.product_id = vci_inner.product_id
      JOIN public.dispatch_po_allocations dpa ON dpa.dispatch_item_id = di.id
      WHERE vci_inner.purchase_order_item_id IS NULL
      ORDER BY vci_inner.id, dpa.created_at NULLS LAST
    ) x
    WHERE vci.id = x.vat_challan_item_id;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.vat_challans DROP CONSTRAINT IF EXISTS vat_challans_dispatch_id_fkey;
ALTER TABLE IF EXISTS public.vat_challans DROP COLUMN IF EXISTS dispatch_id;
DROP TABLE IF EXISTS public.dispatch_status_logs CASCADE;
DROP TABLE IF EXISTS public.dispatch_po_allocations CASCADE;
DROP TABLE IF EXISTS public.dispatch_items CASCADE;
DROP TABLE IF EXISTS public.dispatches CASCADE;