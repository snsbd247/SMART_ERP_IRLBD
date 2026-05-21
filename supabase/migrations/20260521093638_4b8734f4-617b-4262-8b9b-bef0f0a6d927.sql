
-- 1. bom_expenses: replace permissive policy
DROP POLICY IF EXISTS "bom_expenses all access" ON public.bom_expenses;
CREATE POLICY "Authenticated read bom_expenses" ON public.bom_expenses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins manage bom_expenses" ON public.bom_expenses
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 2. Branding: drop loose authenticated write policies (super admin policy stays)
DROP POLICY IF EXISTS "Authenticated upload branding" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update branding" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete branding" ON storage.objects;

-- 3. Employee photos: drop loose authenticated write policies + public read
DROP POLICY IF EXISTS "Authenticated users can upload employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view employee photos" ON storage.objects;

-- 4. employee_emergency_contacts: let owning employee read their own
CREATE POLICY "Employee reads own emergency contacts"
  ON public.employee_emergency_contacts
  FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
