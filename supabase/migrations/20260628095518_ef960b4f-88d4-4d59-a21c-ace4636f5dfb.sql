-- Remove overly permissive Authenticated CRUD policy on invoice_status_logs.
-- Writes should only happen via service_role (Laravel backend / edge functions).
DROP POLICY IF EXISTS "Authenticated CRUD invoice_status_logs" ON public.invoice_status_logs;

-- Defensively revoke INSERT/UPDATE/DELETE on audit_log from authenticated.
-- Audit writes must come exclusively from service_role.
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM anon;

-- Defensively revoke INSERT/UPDATE/DELETE on invoice_status_logs from authenticated.
REVOKE INSERT, UPDATE, DELETE ON public.invoice_status_logs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoice_status_logs FROM anon;

-- Lock down SECURITY DEFINER functions: revoke EXECUTE from anon where unsafe,
-- and from authenticated for functions that should only be triggered server-side.
-- handle_new_user runs as a trigger only.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

-- get_email_by_username must remain callable by anon (used for username-based login)
-- but does not need to be exposed to PUBLIC.
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO anon;

-- is_super_admin is invoked inside RLS policies — authenticated must keep EXECUTE,
-- but anon does not need it.
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

-- suggest_account_code is called from authenticated app code only.
REVOKE EXECUTE ON FUNCTION public.suggest_account_code(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_account_code(text, uuid) TO authenticated;