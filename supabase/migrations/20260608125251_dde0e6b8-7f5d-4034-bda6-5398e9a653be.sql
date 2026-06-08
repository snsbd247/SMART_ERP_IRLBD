GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_amendments TO authenticated;
GRANT ALL ON public.po_amendments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatches TO authenticated;
GRANT ALL ON public.dispatches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_items TO authenticated;
GRANT ALL ON public.dispatch_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_po_allocations TO authenticated;
GRANT ALL ON public.dispatch_po_allocations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_status_logs TO authenticated;
GRANT ALL ON public.dispatch_status_logs TO service_role;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_challans TO authenticated;
GRANT ALL ON public.invoice_challans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_invoices_v2 TO authenticated;
GRANT ALL ON public.sales_invoices_v2 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_invoice_items_v2 TO authenticated;
GRANT ALL ON public.sales_invoice_items_v2 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_payments TO authenticated;
GRANT ALL ON public.invoice_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_status_logs TO authenticated;
GRANT ALL ON public.invoice_status_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tds_entries TO authenticated;
GRANT ALL ON public.tds_entries TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_master TO authenticated;
GRANT ALL ON public.item_master TO service_role;