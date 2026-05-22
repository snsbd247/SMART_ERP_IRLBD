-- Add Sales Mode mutually exclusive sub-modules: sales_basic vs sales_vat
INSERT INTO public.module_settings (module_name, module_key, is_enabled)
VALUES
  ('Basic Sales', 'sales_basic', true),
  ('Bangladesh VAT Sales Workflow', 'sales_vat', false)
ON CONFLICT (module_key) DO NOTHING;