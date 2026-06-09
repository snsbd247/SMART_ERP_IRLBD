ALTER TABLE public.purchase_orders_v2
  ADD CONSTRAINT purchase_orders_v2_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;

ALTER TABLE public.purchase_order_items_v2
  ADD CONSTRAINT poi_v2_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) NOT VALID;

ALTER TABLE public.purchase_requisition_items
  ADD CONSTRAINT pr_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) NOT VALID;

ALTER TABLE public.grns
  ADD CONSTRAINT grns_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;

ALTER TABLE public.grn_items
  ADD CONSTRAINT grn_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) NOT VALID;

ALTER TABLE public.purchase_bills
  ADD CONSTRAINT purchase_bills_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) NOT VALID;

NOTIFY pgrst, 'reload schema';