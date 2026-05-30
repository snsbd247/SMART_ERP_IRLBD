-- Remove orphan module keys from role_permissions that are no longer in the canonical list
DELETE FROM public.role_permissions
WHERE module IN (
  'administration',
  'purchase_orders',
  'dispatch',
  'vat_challan',
  'delivery_challan',
  'customer_receive',
  'ho_receive',
  'invoice_processing',
  'tds_register',
  'sales_workflow_reports'
);