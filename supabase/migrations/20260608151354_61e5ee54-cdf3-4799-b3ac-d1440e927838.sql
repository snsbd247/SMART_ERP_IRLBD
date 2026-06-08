
-- Restrict user_custom_roles SELECT to own rows or super admin
DROP POLICY IF EXISTS "Authenticated read user_custom_roles" ON public.user_custom_roles;
CREATE POLICY "Users read own role assignments"
  ON public.user_custom_roles FOR SELECT
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- Restrict system_settings SELECT to super admins (may contain encrypted/sensitive config)
DROP POLICY IF EXISTS "Authenticated read system_settings" ON public.system_settings;
CREATE POLICY "Super admins read system_settings"
  ON public.system_settings FOR SELECT
  USING (public.is_super_admin(auth.uid()));
