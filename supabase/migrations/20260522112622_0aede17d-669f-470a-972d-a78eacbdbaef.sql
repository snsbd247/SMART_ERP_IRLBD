DO $$
DECLARE
  v_map jsonb := '{}'::jsonb;
  v_id uuid;
  rec record;
  accounts jsonb := '[
    ["1000","Assets","asset",null],
    ["1100","Current Assets","asset","1000"],
    ["1101","Cash in Hand","asset","1100"],
    ["1102","Bank Account","asset","1100"],
    ["1103","Accounts Receivable","asset","1100"],
    ["1104","Advance to Supplier","asset","1100"],
    ["1105","Inventory","asset","1100"],
    ["1106","Prepaid Expenses","asset","1100"],
    ["1200","Fixed Assets","asset","1000"],
    ["1201","Furniture & Fixtures","asset","1200"],
    ["1202","Office Equipment","asset","1200"],
    ["1203","Vehicles","asset","1200"],
    ["1204","Building","asset","1200"],
    ["1205","Accumulated Depreciation","asset","1200"],
    ["2000","Liabilities","liability",null],
    ["2100","Current Liabilities","liability","2000"],
    ["2101","Accounts Payable","liability","2100"],
    ["2102","Supplier Payable","liability","2100"],
    ["2103","Accrued Expenses","liability","2100"],
    ["2104","VAT Payable","liability","2100"],
    ["2105","Loan Payable (Short Term)","liability","2100"],
    ["2200","Long-Term Liabilities","liability","2000"],
    ["2201","Bank Loan","liability","2200"],
    ["2202","Directors Loan","liability","2200"],
    ["3000","Equity","equity",null],
    ["3101","Owner Capital","equity","3000"],
    ["3102","Retained Earnings","equity","3000"],
    ["3103","Drawings","equity","3000"],
    ["4000","Income","income",null],
    ["4101","Sales Revenue","income","4000"],
    ["4102","Service Income","income","4000"],
    ["4103","Other Income","income","4000"],
    ["4104","Discount Received","income","4000"],
    ["5000","Expenses","expense",null],
    ["5100","Direct Expenses","expense","5000"],
    ["5101","Purchase","expense","5100"],
    ["5102","Cost of Goods Sold","expense","5100"],
    ["5200","Operating Expenses","expense","5000"],
    ["5201","Salary Expense","expense","5200"],
    ["5202","Rent Expense","expense","5200"],
    ["5203","Utility Bills","expense","5200"],
    ["5204","Office Expense","expense","5200"],
    ["5205","Transportation","expense","5200"],
    ["5206","Marketing Expense","expense","5200"],
    ["5207","Internet Bill","expense","5200"],
    ["5208","Maintenance Expense","expense","5200"],
    ["5300","Financial Expenses","expense","5000"],
    ["5301","Bank Charge","expense","5300"],
    ["5302","Interest Expense","expense","5300"],
    ["6000","VAT & TAX","liability",null],
    ["6101","Input VAT","asset","6000"],
    ["6102","Output VAT","liability","6000"],
    ["6103","VAT Payable","liability","6000"]
  ]'::jsonb;
  item jsonb;
  code text; name text; atype text; parent_code text; parent_id uuid;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(accounts)
  LOOP
    code := item->>0;
    name := item->>1;
    atype := item->>2;
    parent_code := item->>3;
    parent_id := NULL;
    IF parent_code IS NOT NULL THEN
      parent_id := (v_map->>parent_code)::uuid;
    END IF;
    INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, parent_id)
    VALUES (code, name, atype, parent_id)
    ON CONFLICT (account_code) DO UPDATE SET account_name = EXCLUDED.account_name
    RETURNING id INTO v_id;
    v_map := v_map || jsonb_build_object(code, v_id::text);
  END LOOP;
END $$;