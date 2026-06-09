
-- biometric_devices: drop authenticated read
DROP POLICY IF EXISTS "Authenticated read biometric_devices" ON public.biometric_devices;
CREATE POLICY "Super admins read biometric_devices" ON public.biometric_devices
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

-- biometric_logs: drop broad CRUD
DROP POLICY IF EXISTS "Authenticated CRUD biometric_logs" ON public.biometric_logs;

-- conversation_participants: drop broad CRUD, add scoped write policies
DROP POLICY IF EXISTS "Authenticated CRUD conversation_participants" ON public.conversation_participants;
CREATE POLICY "Users insert own participation" ON public.conversation_participants
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own participation" ON public.conversation_participants
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own participation" ON public.conversation_participants
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- messages: drop broad CRUD, add scoped update/delete
DROP POLICY IF EXISTS "Authenticated CRUD messages" ON public.messages;
CREATE POLICY "Senders update own messages" ON public.messages
  FOR UPDATE TO authenticated USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());
CREATE POLICY "Senders delete own messages" ON public.messages
  FOR DELETE TO authenticated USING (sender_id = auth.uid());

-- user_favorite_pages: drop broad CRUD; user-scoped policy remains
DROP POLICY IF EXISTS "Authenticated CRUD user_favorite_pages" ON public.user_favorite_pages;

-- system_settings: drop anon read
DROP POLICY IF EXISTS "Anon read system_settings" ON public.system_settings;

-- purchase_audit_log: restrict reads to super admins
DROP POLICY IF EXISTS audit_log_read ON public.purchase_audit_log;
CREATE POLICY audit_log_read ON public.purchase_audit_log
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

-- purchase_settings: authenticated read, super-admin writes
DROP POLICY IF EXISTS purchase_settings_auth_all ON public.purchase_settings;
CREATE POLICY purchase_settings_auth_read ON public.purchase_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY purchase_settings_admin_write ON public.purchase_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- purchase_approval_matrix
DROP POLICY IF EXISTS approval_matrix_auth_all ON public.purchase_approval_matrix;
CREATE POLICY approval_matrix_auth_read ON public.purchase_approval_matrix
  FOR SELECT TO authenticated USING (true);
CREATE POLICY approval_matrix_admin_write ON public.purchase_approval_matrix
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- purchase_coa_mapping
DROP POLICY IF EXISTS coa_mapping_auth_all ON public.purchase_coa_mapping;
CREATE POLICY coa_mapping_auth_read ON public.purchase_coa_mapping
  FOR SELECT TO authenticated USING (true);
CREATE POLICY coa_mapping_admin_write ON public.purchase_coa_mapping
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
