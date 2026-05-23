DO $$
DECLARE
  t text;
  excluded text[] := ARRAY[
    'audit_log','user_roles','user_custom_roles','role_permissions','custom_roles',
    'profiles','backup_history','backup_settings','login_logs'
  ];
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> ALL(excluded)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated CRUD %1$s" ON public.%1$I;', t);
    EXECUTE format(
      'CREATE POLICY "Authenticated CRUD %1$s" ON public.%1$I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);',
      t
    );
  END LOOP;
END $$;

-- Profiles: keep super-admin manage; allow each user to read & update their own row
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid() OR is_super_admin(auth.uid()))
  WITH CHECK (id = auth.uid() OR is_super_admin(auth.uid()));

-- Read-only access for normal users on sensitive lookup tables they need to display
DROP POLICY IF EXISTS "Authenticated read custom_roles" ON public.custom_roles;
CREATE POLICY "Authenticated read custom_roles" ON public.custom_roles
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read role_permissions" ON public.role_permissions;
CREATE POLICY "Authenticated read role_permissions" ON public.role_permissions
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read user_custom_roles" ON public.user_custom_roles;
CREATE POLICY "Authenticated read user_custom_roles" ON public.user_custom_roles
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read user_roles" ON public.user_roles;
CREATE POLICY "Authenticated read user_roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);