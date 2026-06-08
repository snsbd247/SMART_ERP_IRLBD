ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) NOT VALID;
ALTER TABLE public.purchase_orders VALIDATE CONSTRAINT purchase_orders_customer_id_fkey;

ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT purchase_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.item_master(id) NOT VALID;
ALTER TABLE public.purchase_order_items VALIDATE CONSTRAINT purchase_order_items_product_id_fkey;

ALTER TABLE public.dispatches
  ADD CONSTRAINT dispatches_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) NOT VALID;
ALTER TABLE public.dispatches VALIDATE CONSTRAINT dispatches_customer_id_fkey;

ALTER TABLE public.dispatch_items
  ADD CONSTRAINT dispatch_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.item_master(id) NOT VALID;
ALTER TABLE public.dispatch_items VALIDATE CONSTRAINT dispatch_items_product_id_fkey;

ALTER TABLE public.dispatch_po_allocations
  ADD CONSTRAINT dispatch_po_allocations_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) NOT VALID;
ALTER TABLE public.dispatch_po_allocations VALIDATE CONSTRAINT dispatch_po_allocations_po_id_fkey;

ALTER TABLE public.vat_challans
  ADD CONSTRAINT vat_challans_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) NOT VALID;
ALTER TABLE public.vat_challans VALIDATE CONSTRAINT vat_challans_customer_id_fkey;

ALTER TABLE public.vat_challan_items
  ADD CONSTRAINT vat_challan_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.item_master(id) NOT VALID;
ALTER TABLE public.vat_challan_items VALIDATE CONSTRAINT vat_challan_items_product_id_fkey;

ALTER TABLE public.delivery_challans
  ADD CONSTRAINT delivery_challans_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.item_master(id) NOT VALID,
  ADD CONSTRAINT delivery_challans_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) NOT VALID;
ALTER TABLE public.delivery_challans VALIDATE CONSTRAINT delivery_challans_product_id_fkey;
ALTER TABLE public.delivery_challans VALIDATE CONSTRAINT delivery_challans_customer_id_fkey;

ALTER TABLE public.sales_invoices_v2
  ADD CONSTRAINT sales_invoices_v2_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) NOT VALID;
ALTER TABLE public.sales_invoices_v2 VALIDATE CONSTRAINT sales_invoices_v2_customer_id_fkey;

ALTER TABLE public.sales_invoice_items_v2
  ADD CONSTRAINT sales_invoice_items_v2_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.item_master(id) NOT VALID;
ALTER TABLE public.sales_invoice_items_v2 VALIDATE CONSTRAINT sales_invoice_items_v2_product_id_fkey;

NOTIFY pgrst, 'reload schema';