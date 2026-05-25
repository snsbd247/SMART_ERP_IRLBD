
-- employee_documents
DROP POLICY IF EXISTS "Authenticated CRUD employee_documents" ON public.employee_documents;
DROP POLICY IF EXISTS "Users view own documents" ON public.employee_documents;
DROP POLICY IF EXISTS "Super admins manage employee_documents" ON public.employee_documents;
CREATE POLICY "Users view own documents" ON public.employee_documents
  FOR SELECT USING (
    is_super_admin(auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid())
  );
CREATE POLICY "Super admins manage employee_documents" ON public.employee_documents
  FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- face_data
DROP POLICY IF EXISTS "Authenticated CRUD face_data" ON public.face_data;
DROP POLICY IF EXISTS "Users view own face_data" ON public.face_data;
DROP POLICY IF EXISTS "Super admins manage face_data" ON public.face_data;
CREATE POLICY "Users view own face_data" ON public.face_data
  FOR SELECT USING (
    is_super_admin(auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid())
  );
CREATE POLICY "Super admins manage face_data" ON public.face_data
  FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- sms_logs
DROP POLICY IF EXISTS "Authenticated CRUD sms_logs" ON public.sms_logs;
DROP POLICY IF EXISTS "Super admins manage sms_logs" ON public.sms_logs;
CREATE POLICY "Super admins manage sms_logs" ON public.sms_logs
  FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- user_activities
DROP POLICY IF EXISTS "Authenticated CRUD user_activities" ON public.user_activities;
DROP POLICY IF EXISTS "Users view own activity" ON public.user_activities;
DROP POLICY IF EXISTS "Users insert own activity" ON public.user_activities;
DROP POLICY IF EXISTS "Super admins manage user_activities" ON public.user_activities;
CREATE POLICY "Users view own activity" ON public.user_activities
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin(auth.uid()));
CREATE POLICY "Users insert own activity" ON public.user_activities
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin(auth.uid()));
CREATE POLICY "Super admins manage user_activities" ON public.user_activities
  FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- biometric_devices
DROP POLICY IF EXISTS "Authenticated CRUD biometric_devices" ON public.biometric_devices;
DROP POLICY IF EXISTS "Authenticated read biometric_devices" ON public.biometric_devices;
DROP POLICY IF EXISTS "Super admins manage biometric_devices" ON public.biometric_devices;
CREATE POLICY "Authenticated read biometric_devices" ON public.biometric_devices
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Super admins manage biometric_devices" ON public.biometric_devices
  FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- Config tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['company_settings','system_settings','module_settings','number_sequences','financial_years','branches']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated CRUD %I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated read %I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Super admins manage %I" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Authenticated read %I" ON public.%I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format('CREATE POLICY "Super admins manage %I" ON public.%I FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()))', t, t);
  END LOOP;
END $$;

-- profiles
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile safe columns" ON public.profiles;
CREATE POLICY "Users update own profile safe columns" ON public.profiles
  FOR UPDATE
  USING (id = auth.uid() OR is_super_admin(auth.uid()))
  WITH CHECK (
    is_super_admin(auth.uid())
    OR (
      id = auth.uid()
      AND employee_id IS NOT DISTINCT FROM (SELECT employee_id FROM public.profiles WHERE id = auth.uid())
      AND status IS NOT DISTINCT FROM (SELECT status FROM public.profiles WHERE id = auth.uid())
      AND username IS NOT DISTINCT FROM (SELECT username FROM public.profiles WHERE id = auth.uid())
      AND email IS NOT DISTINCT FROM (SELECT email FROM public.profiles WHERE id = auth.uid())
    )
  );
