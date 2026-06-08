GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_amendments TO authenticated;
GRANT ALL ON public.po_amendments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vat_challans TO authenticated;
GRANT ALL ON public.vat_challans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vat_challan_items TO authenticated;
GRANT ALL ON public.vat_challan_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_challans TO authenticated;
GRANT ALL ON public.delivery_challans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_receives TO authenticated;
GRANT ALL ON public.customer_receives TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ho_receives TO authenticated;
GRANT ALL ON public.ho_receives TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_invoices_v2 TO authenticated;
GRANT ALL ON public.sales_invoices_v2 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_invoice_items_v2 TO authenticated;
GRANT ALL ON public.sales_invoice_items_v2 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_challans TO authenticated;
GRANT ALL ON public.invoice_challans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_payments TO authenticated;
GRANT ALL ON public.invoice_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_status_logs TO authenticated;
GRANT ALL ON public.invoice_status_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tds_entries TO authenticated;
GRANT ALL ON public.tds_entries TO service_role;

UPDATE public.vat_challans
SET source = 'purchase_order'
WHERE source IS DISTINCT FROM 'purchase_order';

ALTER TABLE public.vat_challans
  ALTER COLUMN purchase_order_id SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'purchase_order';

ALTER TABLE public.vat_challan_items
  ALTER COLUMN purchase_order_item_id SET NOT NULL;

ALTER TABLE IF EXISTS public.vat_challans DROP CONSTRAINT IF EXISTS vat_challans_source_new_workflow_chk;
ALTER TABLE public.vat_challans
  ADD CONSTRAINT vat_challans_source_new_workflow_chk CHECK (source = 'purchase_order');

DROP TABLE IF EXISTS public.dispatch_status_logs CASCADE;
DROP TABLE IF EXISTS public.dispatch_po_allocations CASCADE;
DROP TABLE IF EXISTS public.dispatch_items CASCADE;
DROP TABLE IF EXISTS public.dispatches CASCADE;

NOTIFY pgrst, 'reload schema';