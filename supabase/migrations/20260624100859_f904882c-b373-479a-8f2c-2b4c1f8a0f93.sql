
-- 1. employee_fund_settings: allow employees to read their own fund settings.
CREATE POLICY "fund_settings_self_read"
  ON public.employee_fund_settings
  FOR SELECT
  TO authenticated
  USING (
    employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid())
  );

-- 2. Tighten EXECUTE on suggest_account_code: revoke from PUBLIC + anon, keep authenticated.
REVOKE EXECUTE ON FUNCTION public.suggest_account_code(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.suggest_account_code(text, uuid) FROM anon;
