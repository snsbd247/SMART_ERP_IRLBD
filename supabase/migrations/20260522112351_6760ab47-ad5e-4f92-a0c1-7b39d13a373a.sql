
-- Seed Bangladesh Chart of Accounts (idempotent: skips if account_code already exists)
DO $$
DECLARE
  v_parent_map jsonb := '{}'::jsonb;
  v_row record;
  v_id uuid;
  v_parent_id uuid;
  accounts text[][] := ARRAY[
    -- code, name, type, parent_code
    ['1000','Assets','asset',NULL],
    ['1100','Current Assets','asset','1000'],
    ['1101','Cash in Hand','asset','1100'],
    ['1102','Bank Account','asset','1100'],
    ['1103','Accounts Receivable','asset','1100'],
    ['1104','Advance to Supplier','asset','1100'],
    ['1105','Inventory','asset','1100'],
    ['1106','Prepaid Expenses','asset','1100'],
    ['1200','Fixed Assets','asset','1000'],
    ['1201','Furniture & Fixtures','asset','1200'],
    ['1202','Office Equipment','asset','1200'],
    ['1203','Vehicles','asset','1200'],
    ['1204','Building','asset','1200'],
    ['1205','Accumulated Depreciation','asset','1200'],
    ['2000','Liabilities','liability',NULL],
    ['2100','Current Liabilities','liability','2000'],
    ['2101','Accounts Payable','liability','2100'],
    ['2102','Supplier Payable','liability','2100'],
    ['2103','Accrued Expenses','liability','2100'],
    ['2104','VAT Payable','liability','2100'],
    ['2105','Loan Payable (Short Term)','liability','2100'],
    ['2200','Long-Term Liabilities','liability','2000'],
    ['2201','Bank Loan','liability','2200'],
    ['2202','Directors Loan','liability','2200'],
    ['3000','Equity','equity',NULL],
    ['3101','Owner Capital','equity','3000'],
    ['3102','Retained Earnings','equity','3000'],
    ['3103','Drawings','equity','3000'],
    ['4000','Income','income',NULL],
    ['4101','Sales Revenue','income','4000'],
    ['4102','Service Income','income','4000'],
    ['4103','Other Income','income','4000'],
    ['4104','Discount Received','income','4000'],
    ['5000','Expenses','expense',NULL],
    ['5100','Direct Expenses','expense','5000'],
    ['5101','Purchase','expense','5100'],
    ['5102','Cost of Goods Sold','expense','5100'],
    ['5200','Operating Expenses','expense','5000'],
    ['5201','Salary Expense','expense','5200'],
    ['5202','Rent Expense','expense','5200'],
    ['5203','Utility Bills','expense','5200'],
    ['5204','Office Expense','expense','5200'],
    ['5205','Transportation','expense','5200'],
    ['5206','Marketing Expense','expense','5200'],
    ['5207','Internet Bill','expense','5200'],
    ['5208','Maintenance Expense','expense','5200'],
    ['5300','Financial Expenses','expense','5000'],
    ['5301','Bank Charge','expense','5300'],
    ['5302','Interest Expense','expense','5300'],
    ['6000','VAT & TAX','liability',NULL],
    ['6101','Input VAT','asset','6000'],
    ['6102','Output VAT','liability','6000'],
    ['6103','VAT Payable','liability','6000']
  ];
  i int;
BEGIN
  FOR i IN 1..array_length(accounts,1) LOOP
    v_parent_id := NULL;
    IF accounts[i][4] IS NOT NULL THEN
      v_parent_id := (v_parent_map ->> accounts[i][4])::uuid;
    END IF;

    -- skip if code already exists
    SELECT id INTO v_id FROM public.chart_of_accounts WHERE account_code = accounts[i][1] LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, parent_id, is_active)
      VALUES (accounts[i][1], accounts[i][2], accounts[i][3], v_parent_id, true)
      RETURNING id INTO v_id;
    END IF;

    v_parent_map := v_parent_map || jsonb_build_object(accounts[i][1], v_id::text);
  END LOOP;
END $$;
