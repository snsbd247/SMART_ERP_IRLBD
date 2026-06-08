REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';