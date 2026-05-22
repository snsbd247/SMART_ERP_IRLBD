
WITH ar AS (SELECT id, account_code FROM chart_of_accounts WHERE id='ed725e57-7f0f-441f-b981-03d57443a363'),
sp AS (SELECT id, account_code FROM chart_of_accounts WHERE id='d978960a-59df-4f32-a784-31a9f0440777'),
new_customers AS (
  SELECT c.name, row_number() OVER (ORDER BY c.name) AS rn
  FROM customers c
  WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.account_name = c.name AND a.account_type='asset')
),
new_suppliers AS (
  SELECT s.name, row_number() OVER (ORDER BY s.name) AS rn
  FROM suppliers s
  WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.account_name = s.name AND a.account_type='liability')
),
ins_cust AS (
  INSERT INTO chart_of_accounts (account_code, account_name, account_type, parent_id, opening_balance, opening_balance_type, is_active)
  SELECT ar.account_code || lpad(nc.rn::text, 3, '0'), nc.name, 'asset', ar.id, 0, 'debit', true
  FROM new_customers nc, ar
  RETURNING 1
),
ins_sup AS (
  INSERT INTO chart_of_accounts (account_code, account_name, account_type, parent_id, opening_balance, opening_balance_type, is_active)
  SELECT sp.account_code || lpad(ns.rn::text, 3, '0'), ns.name, 'liability', sp.id, 0, 'credit', true
  FROM new_suppliers ns, sp
  RETURNING 1
)
SELECT (SELECT count(*) FROM ins_cust) AS customers_added, (SELECT count(*) FROM ins_sup) AS suppliers_added;
