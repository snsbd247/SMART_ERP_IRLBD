
-- Format validation: numeric, 3-10 digits
ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_account_code_format_chk;
ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_account_code_format_chk
  CHECK (account_code ~ '^[0-9]{3,10}$');

-- Server-side suggester: next free code based on type / parent.
-- Mirrors the frontend logic so other API clients get identical behavior.
CREATE OR REPLACE FUNCTION public.suggest_account_code(_type text, _parent_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base int;
  parent_code text;
  start_n bigint;
  n bigint;
  candidate text;
BEGIN
  IF _parent_id IS NOT NULL THEN
    SELECT account_code INTO parent_code FROM public.chart_of_accounts WHERE id = _parent_id;
  END IF;

  IF parent_code IS NOT NULL AND parent_code ~ '^[0-9]+$' THEN
    start_n := parent_code::bigint + 1;
  ELSE
    base := CASE lower(_type)
      WHEN 'asset' THEN 1000
      WHEN 'liability' THEN 2000
      WHEN 'equity' THEN 3000
      WHEN 'income' THEN 4000
      WHEN 'expense' THEN 5000
      ELSE 1000
    END;
    start_n := base + 1;
  END IF;

  n := start_n;
  WHILE n <= 9999999999 LOOP
    candidate := lpad(n::text, GREATEST(4, length(start_n::text)), '0');
    IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE account_code = candidate) THEN
      RETURN candidate;
    END IF;
    n := n + 1;
  END LOOP;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_account_code(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_account_code(text, uuid) TO service_role;
