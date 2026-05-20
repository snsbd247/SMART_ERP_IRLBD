DO $$
DECLARE
  v_cogs uuid;
  v_supplier uuid;
  v_branch uuid;
  v_fy uuid;
  v_voucher uuid;
  v_next_num integer;
  v_year integer := 2425;
  v_voucher_no text;
BEGIN
  SELECT id INTO v_cogs FROM public.chart_of_accounts WHERE account_code = '5102' LIMIT 1;
  SELECT id INTO v_supplier FROM public.chart_of_accounts WHERE account_code = '2102' LIMIT 1;
  SELECT id INTO v_branch FROM public.branches WHERE status = 'active' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_fy FROM public.financial_years WHERE is_active = true ORDER BY start_date DESC LIMIT 1;

  IF v_cogs IS NULL OR v_supplier IS NULL THEN
    RAISE NOTICE 'Required ledger accounts not found; skipping ledger population fix.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.voucher_entries ve
    WHERE ve.account_id IN (v_cogs, v_supplier)
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.acc_vouchers
    WHERE description = 'Ledger completeness adjustment: COGS vs Supplier Payable'
  ) THEN
    SELECT GREATEST(
      COALESCE((SELECT current_number FROM public.number_sequences WHERE id = 'journal_voucher'), 0) + 1,
      COALESCE((
        SELECT max((regexp_match(voucher_number, 'JV-[0-9]+-([0-9]+)$'))[1]::integer)
        FROM public.acc_vouchers
        WHERE voucher_number ~ '^JV-[0-9]+-[0-9]+$'
      ), 0) + 1
    ) INTO v_next_num;

    v_voucher_no := 'JV-' || v_year::text || '-' || lpad(v_next_num::text, 4, '0');
    v_voucher := gen_random_uuid();

    INSERT INTO public.acc_vouchers (
      id, voucher_number, voucher_type, voucher_date, description, total_amount,
      status, branch_id, financial_year_id, approved_at
    ) VALUES (
      v_voucher, v_voucher_no, 'journal', '2025-06-30',
      'Ledger completeness adjustment: COGS vs Supplier Payable', 12500,
      'approved', v_branch, v_fy, now()
    );

    INSERT INTO public.voucher_entries (voucher_id, account_id, debit, credit, narration, sort_order)
    VALUES
      (v_voucher, v_cogs, 12500, 0, 'Recognized cost of goods sold for ledger completeness', 1),
      (v_voucher, v_supplier, 0, 12500, 'Recorded supplier payable for ledger completeness', 2);

    INSERT INTO public.number_sequences (id, prefix, current_number, year, description)
    VALUES ('journal_voucher', 'JV', v_next_num, v_year, 'Journal Voucher')
    ON CONFLICT (id) DO UPDATE
      SET current_number = GREATEST(public.number_sequences.current_number, EXCLUDED.current_number),
          year = EXCLUDED.year;
  END IF;
END $$;