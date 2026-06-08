
-- Restrict DELETE on accounting voucher tables to Super Admin only.
-- Keep SELECT/INSERT/UPDATE open to authenticated users (matching previous behavior).

DROP POLICY IF EXISTS "Authenticated CRUD acc_vouchers" ON public.acc_vouchers;
DROP POLICY IF EXISTS "Authenticated CRUD voucher_entries" ON public.voucher_entries;

CREATE POLICY "Authenticated read acc_vouchers" ON public.acc_vouchers
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated insert acc_vouchers" ON public.acc_vouchers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated update acc_vouchers" ON public.acc_vouchers
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Super admin delete acc_vouchers" ON public.acc_vouchers
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Authenticated read voucher_entries" ON public.voucher_entries
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated insert voucher_entries" ON public.voucher_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated update voucher_entries" ON public.voucher_entries
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Super admin delete voucher_entries" ON public.voucher_entries
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));
