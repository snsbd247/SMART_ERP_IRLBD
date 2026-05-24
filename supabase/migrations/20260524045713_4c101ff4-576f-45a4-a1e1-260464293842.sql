
INSERT INTO public.number_sequences (id, prefix, current_number, year, description) VALUES
  ('journal_voucher', 'JV', 0, EXTRACT(year FROM CURRENT_DATE)::int, 'Journal Voucher'),
  ('payment_voucher', 'PV', 0, EXTRACT(year FROM CURRENT_DATE)::int, 'Payment Voucher'),
  ('receipt_voucher', 'RV', 0, EXTRACT(year FROM CURRENT_DATE)::int, 'Receipt Voucher'),
  ('contra_voucher',  'CV', 0, EXTRACT(year FROM CURRENT_DATE)::int, 'Contra Voucher'),
  ('production',      'PRD',0, EXTRACT(year FROM CURRENT_DATE)::int, 'Production Entry'),
  ('sales_invoice',   'INV',0, EXTRACT(year FROM CURRENT_DATE)::int, 'Sales Invoice'),
  ('purchase',        'PUR',0, EXTRACT(year FROM CURRENT_DATE)::int, 'Purchase'),
  ('expense',         'EXP',0, EXTRACT(year FROM CURRENT_DATE)::int, 'Expense'),
  ('income',          'INC',0, EXTRACT(year FROM CURRENT_DATE)::int, 'Income')
ON CONFLICT (id) DO NOTHING;
