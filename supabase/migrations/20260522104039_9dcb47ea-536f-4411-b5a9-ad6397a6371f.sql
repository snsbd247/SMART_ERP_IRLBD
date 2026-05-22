-- Full reset: keep only users, profiles, roles, role permissions, module_settings
DO $$
DECLARE
  tbl text;
  keep text[] := ARRAY[
    'profiles',
    'user_roles',
    'custom_roles',
    'user_custom_roles',
    'role_permissions',
    'module_settings'
  ];
  tables_csv text;
BEGIN
  SELECT string_agg(format('public.%I', tablename), ', ')
  INTO tables_csv
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> ALL(keep);

  IF tables_csv IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || tables_csv || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;