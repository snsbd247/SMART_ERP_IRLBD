
DROP TABLE IF EXISTS public.purchase_bill_payments CASCADE;
DROP TABLE IF EXISTS public.purchase_bill_grns CASCADE;
DROP TABLE IF EXISTS public.purchase_bills CASCADE;
DROP TABLE IF EXISTS public.grn_items CASCADE;
DROP TABLE IF EXISTS public.grns CASCADE;
DROP TABLE IF EXISTS public.purchase_order_items_v2 CASCADE;
DROP TABLE IF EXISTS public.purchase_orders_v2 CASCADE;
DROP TABLE IF EXISTS public.purchase_requisition_items CASCADE;
DROP TABLE IF EXISTS public.purchase_requisitions CASCADE;
DROP TABLE IF EXISTS public.po_amendments CASCADE;
DROP TABLE IF EXISTS public.purchase_order_items CASCADE;
DROP TABLE IF EXISTS public.purchase_orders CASCADE;
DROP TABLE IF EXISTS public.purchase_return_items CASCADE;
DROP TABLE IF EXISTS public.purchase_returns CASCADE;
DROP TABLE IF EXISTS public.purchase_items CASCADE;
DROP TABLE IF EXISTS public.purchases CASCADE;
DROP TABLE IF EXISTS public.suppliers CASCADE;

DELETE FROM public.number_sequences
 WHERE prefix IN ('PR','PO','GRN','BILL','BP','PUR','PRET');

DELETE FROM public.page_shortcuts
 WHERE shortcut_code IN ('PREQ','PPO','GRN','BILL','PUR','PRET','SUP')
    OR module_name IN ('purchase','suppliers');

DELETE FROM public.role_permissions
 WHERE module IN ('purchase','suppliers','purchase_workflow');
