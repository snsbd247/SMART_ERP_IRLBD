
-- Phase 5: BD VAT Sales Workflow — RBAC modules, CoA seed, audit helpers

-- 1) Register workflow modules in module_settings (idempotent)
INSERT INTO public.module_settings (module_key, module_name, is_enabled) VALUES
  ('purchase_orders', 'Purchase Orders (BD)', true),
  ('dispatch', 'Dispatch Management', true),
  ('vat_challan', 'VAT Challan (Mushak 6.3)', true),
  ('delivery_challan', 'Delivery Challan', true),
  ('customer_receive', 'Customer Receive', true),
  ('ho_receive', 'HO Receive', true),
  ('invoice_processing', 'Invoice Processing', true),
  ('tds_register', 'TDS Register', true),
  ('sales_workflow_reports', 'Sales Workflow Reports', true)
ON CONFLICT (module_key) DO NOTHING;

-- 2) Seed missing Bangladesh CoA accounts required by the workflow
INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, parent_id, opening_balance, opening_balance_type, is_active)
SELECT * FROM (VALUES
  ('1104', 'TDS Receivable',          'asset',     NULL::uuid, 0::numeric, 'debit',  true),
  ('1105', 'Advance from Customers',  'liability', NULL::uuid, 0::numeric, 'credit', true),
  ('2105', 'TDS Payable',             'liability', NULL::uuid, 0::numeric, 'credit', true)
) AS v(account_code, account_name, account_type, parent_id, opening_balance, opening_balance_type, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts c WHERE c.account_code = v.account_code
);

-- 3) Grant Super Admin (custom role 'Super Admin' if present) full perms on new modules
INSERT INTO public.role_permissions (custom_role_id, module, can_view, can_add, can_edit, can_delete)
SELECT cr.id, m.module, true, true, true, true
FROM public.custom_roles cr
CROSS JOIN (VALUES
  ('purchase_orders'),
  ('dispatch'),
  ('vat_challan'),
  ('delivery_challan'),
  ('customer_receive'),
  ('ho_receive'),
  ('invoice_processing'),
  ('tds_register'),
  ('sales_workflow_reports')
) AS m(module)
WHERE LOWER(cr.name) IN ('super admin','admin','administrator')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.custom_role_id = cr.id AND rp.module = m.module
  );

-- 4) Number sequences for workflow prefixes (idempotent)
INSERT INTO public.number_sequences (id, prefix, current_number, year)
SELECT * FROM (VALUES
  ('po_seq',  'PO',  0, EXTRACT(YEAR FROM now())::int),
  ('dsp_seq', 'DSP', 0, EXTRACT(YEAR FROM now())::int),
  ('vch_seq', 'VCH', 0, EXTRACT(YEAR FROM now())::int),
  ('dc_seq',  'DC',  0, EXTRACT(YEAR FROM now())::int),
  ('inv_seq', 'INV', 0, EXTRACT(YEAR FROM now())::int),
  ('rcp_seq', 'RCP', 0, EXTRACT(YEAR FROM now())::int),
  ('tds_seq', 'TDS', 0, EXTRACT(YEAR FROM now())::int)
) AS v(id, prefix, current_number, year)
WHERE NOT EXISTS (SELECT 1 FROM public.number_sequences ns WHERE ns.id = v.id);
