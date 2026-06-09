INSERT INTO number_sequences (id, prefix, current_number, year) VALUES
  ('purchase_requisition', 'PRQ', 0, 2526),
  ('purchase_order_v2', 'POV', 0, 2526),
  ('grn', 'GRN', 0, 2526),
  ('purchase_bill', 'PBL', 0, 2526),
  ('purchase_bill_payment', 'PPM', 0, 2526)
ON CONFLICT (id) DO NOTHING;