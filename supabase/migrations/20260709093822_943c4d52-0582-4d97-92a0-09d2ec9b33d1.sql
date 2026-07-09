CREATE OR REPLACE FUNCTION public.reserve_voucher_number(_sequence_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  seq_row public.number_sequences%ROWTYPE;
  current_year int := EXTRACT(YEAR FROM now())::int;
  actual_max int := 0;
  candidate text;
  next_serial int;
  default_prefix text;
  default_description text;
  guard int := 0;
BEGIN
  SELECT * INTO seq_row
  FROM public.number_sequences
  WHERE id = _sequence_id
  FOR UPDATE;

  IF NOT FOUND THEN
    default_prefix := CASE _sequence_id
      WHEN 'journal_voucher' THEN 'JV'
      WHEN 'payment_voucher' THEN 'PV'
      WHEN 'receipt_voucher' THEN 'RV'
      WHEN 'contra_voucher' THEN 'CV'
      ELSE upper(left(regexp_replace(_sequence_id, '[^A-Za-z]', '', 'g'), 3))
    END;
    IF default_prefix IS NULL OR default_prefix = '' THEN
      default_prefix := 'DOC';
    END IF;
    default_description := initcap(replace(_sequence_id, '_', ' '));

    INSERT INTO public.number_sequences (id, prefix, current_number, year, description)
    VALUES (_sequence_id, default_prefix, 0, current_year, default_description);

    SELECT * INTO seq_row
    FROM public.number_sequences
    WHERE id = _sequence_id
    FOR UPDATE;
  END IF;

  IF seq_row.year IS DISTINCT FROM current_year THEN
    seq_row.year := current_year;
    seq_row.current_number := 0;
  END IF;

  IF _sequence_id IN ('journal_voucher', 'payment_voucher', 'receipt_voucher', 'contra_voucher') THEN
    SELECT COALESCE(MAX((substring(voucher_number FROM '^[A-Za-z]+-[0-9]{4}-([0-9]+)$'))::int), 0)
    INTO actual_max
    FROM public.acc_vouchers
    WHERE voucher_number LIKE seq_row.prefix || '-' || seq_row.year || '-%'
      AND substring(voucher_number FROM '^[A-Za-z]+-[0-9]{4}-([0-9]+)$') IS NOT NULL;

    IF actual_max > seq_row.current_number THEN
      seq_row.current_number := actual_max;
    END IF;
  END IF;

  next_serial := seq_row.current_number + 1;
  candidate := seq_row.prefix || '-' || seq_row.year || '-' || lpad(next_serial::text, 5, '0');

  IF _sequence_id IN ('journal_voucher', 'payment_voucher', 'receipt_voucher', 'contra_voucher') THEN
    WHILE EXISTS (SELECT 1 FROM public.acc_vouchers WHERE voucher_number = candidate) LOOP
      guard := guard + 1;
      IF guard > 10000 THEN
        RAISE EXCEPTION 'Could not reserve a unique voucher number for %', _sequence_id;
      END IF;
      next_serial := next_serial + 1;
      candidate := seq_row.prefix || '-' || seq_row.year || '-' || lpad(next_serial::text, 5, '0');
    END LOOP;
  END IF;

  UPDATE public.number_sequences
  SET current_number = next_serial,
      year = seq_row.year
  WHERE id = _sequence_id;

  RETURN candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_voucher_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_voucher_number(text) TO service_role;