
-- Ensure existing custom roles have rows for all canonical modules.
-- We only INSERT missing rows; nothing is deleted or overwritten.
-- Super Admin role gets full permissions on every new module.
-- Other roles get a row with all-zeros so they appear in the editor and can be toggled by an admin.

DO $$
DECLARE
  r RECORD;
  m TEXT;
  mods TEXT[] := ARRAY[
    -- Core
    'dashboard','messaging',
    -- Accounting
    'accounts','journal','payment','receipt','contra',
    -- Business
    'sales','purchase','customers','suppliers','inventory','manufacturing','bank',
    -- HRM
    'hrm','attendance','leave','payroll','employees','portal',
    -- Reports
    'reports',
    -- Administration
    'branches','users','roles','financial_years','settings','audit_log','backup',
    'sms','branding','shortcuts','document_numbering','modules'
  ];
BEGIN
  FOR r IN SELECT id, name FROM public.custom_roles LOOP
    FOREACH m IN ARRAY mods LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.role_permissions
        WHERE custom_role_id = r.id AND module = m
      ) THEN
        IF lower(r.name) IN ('super admin','superadmin','super_admin') THEN
          INSERT INTO public.role_permissions (custom_role_id, module, can_view, can_add, can_edit, can_delete)
          VALUES (r.id, m, true, true, true, true);
        ELSE
          INSERT INTO public.role_permissions (custom_role_id, module, can_view, can_add, can_edit, can_delete)
          VALUES (r.id, m, false, false, false, false);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
