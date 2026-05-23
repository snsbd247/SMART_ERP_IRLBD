INSERT INTO public.module_settings (module_name, module_key, is_enabled) VALUES
  ('Accounting Module','accounts',true),
  ('Bank & Cash Module','bank',true),
  ('Inventory Module','inventory',true),
  ('Purchase Module','purchase',true),
  ('Manufacturing Module','manufacturing',true),
  ('Basic Sales','sales_basic',true),
  ('Bangladesh VAT Sales Workflow','sales_vat',false),
  ('HRM Module','hrm',true),
  ('Reports Module','reports',true),
  ('Multi Warehouse System','multi_warehouse',false),
  ('Multi Branch System','multi_branch',false)
ON CONFLICT (module_key) DO NOTHING;