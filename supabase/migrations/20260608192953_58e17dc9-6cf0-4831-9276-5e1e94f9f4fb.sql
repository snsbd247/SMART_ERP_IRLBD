-- Allow anonymous users to read branding (system_settings) and basic company info
-- so the login screen can display logo, name, and currency without 401 errors.

CREATE POLICY "Anon read system_settings"
  ON public.system_settings FOR SELECT
  TO anon
  USING (true);

GRANT SELECT ON public.system_settings TO anon;

CREATE POLICY "Anon read company_settings"
  ON public.company_settings FOR SELECT
  TO anon
  USING (true);

GRANT SELECT ON public.company_settings TO anon;