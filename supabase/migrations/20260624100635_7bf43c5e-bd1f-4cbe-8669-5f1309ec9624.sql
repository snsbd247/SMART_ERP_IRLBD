
-- 1. Remove anonymous read access on company_settings (BIN, contact info, etc.)
DROP POLICY IF EXISTS "Anon read company_settings" ON public.company_settings;

-- 2. purchase_audit_log: remove broad authenticated INSERT; service_role bypasses RLS
DROP POLICY IF EXISTS "audit_log_insert" ON public.purchase_audit_log;

-- 3. purchase_approval_matrix: restrict SELECT to super admins or the approver themself
DROP POLICY IF EXISTS "approval_matrix_auth_read" ON public.purchase_approval_matrix;
CREATE POLICY "approval_matrix_admin_or_self_read"
  ON public.purchase_approval_matrix
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR approver_user_id = auth.uid()
  );

-- 4. purchase_coa_mapping: restrict SELECT to super admins (matches write policy)
DROP POLICY IF EXISTS "coa_mapping_auth_read" ON public.purchase_coa_mapping;
CREATE POLICY "coa_mapping_admin_read"
  ON public.purchase_coa_mapping
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
