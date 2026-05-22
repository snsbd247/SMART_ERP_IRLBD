
-- Fix ledger mapping: deactivate duplicate VAT Payable and seed missing system accounts
UPDATE public.chart_of_accounts
   SET is_active = false, account_name = 'VAT Payable (duplicate - inactive)'
 WHERE account_code = '6103';

-- Ensure parent codes exist for new inserts
INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, parent_id, is_active)
SELECT v.code, v.name, v.type,
       (SELECT id FROM public.chart_of_accounts WHERE account_code = v.parent_code LIMIT 1),
       true
  FROM (VALUES
    ('1107', 'TDS Receivable',            'asset',     '1100'),
    ('2106', 'Provident Fund Liability',  'liability', '2100'),
    ('2107', 'Savings Fund Liability',    'liability', '2100'),
    ('4105', 'Sales Return',              'income',    '4000'),
    ('5103', 'Purchase Return',           'expense',   '5100'),
    ('5209', 'Provident Fund Expense',    'expense',   '5200'),
    ('5210', 'Savings Fund Expense',      'expense',   '5200')
  ) AS v(code, name, type, parent_code)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.chart_of_accounts c WHERE c.account_code = v.code
 );
