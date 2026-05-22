DO $$
DECLARE
  v_branch uuid;
  v_fy uuid;
BEGIN
  INSERT INTO public.branches (code, name, phone, address, status)
  VALUES ('HQ', 'Head Office', '', '', 'active')
  RETURNING id INTO v_branch;

  INSERT INTO public.financial_years (name, start_date, end_date, is_active)
  VALUES ('FY 2025-2026', '2025-07-01', '2026-06-30', true)
  RETURNING id INTO v_fy;

  INSERT INTO public.company_settings (
    id, company_name, currency_name, currency_code, currency_symbol, currency_position,
    default_branch_id, default_financial_year_id
  ) VALUES (
    'default', 'My Company', 'Bangladeshi Taka', 'BDT', '৳', 'before', v_branch, v_fy
  )
  ON CONFLICT (id) DO UPDATE SET
    currency_name = EXCLUDED.currency_name,
    currency_code = EXCLUDED.currency_code,
    currency_symbol = EXCLUDED.currency_symbol,
    default_branch_id = EXCLUDED.default_branch_id,
    default_financial_year_id = EXCLUDED.default_financial_year_id;
END $$;