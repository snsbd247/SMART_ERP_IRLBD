
-- Remove overly broad "Authenticated CRUD" ALL policies that bypass restrictive policies via OR logic
DROP POLICY IF EXISTS "Authenticated CRUD attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated CRUD employee_bank_info" ON public.employee_bank_info;
DROP POLICY IF EXISTS "Authenticated CRUD employee_education" ON public.employee_education;
DROP POLICY IF EXISTS "Authenticated CRUD employee_emergency_contacts" ON public.employee_emergency_contacts;
DROP POLICY IF EXISTS "Authenticated CRUD employee_experience" ON public.employee_experience;
DROP POLICY IF EXISTS "Authenticated CRUD employee_fund_settings" ON public.employee_fund_settings;
DROP POLICY IF EXISTS "Authenticated CRUD employees" ON public.employees;
DROP POLICY IF EXISTS "Authenticated CRUD fund_transactions" ON public.fund_transactions;
DROP POLICY IF EXISTS "Authenticated CRUD leave_requests" ON public.leave_requests;
DROP POLICY IF EXISTS "Authenticated CRUD overtime_records" ON public.overtime_records;
DROP POLICY IF EXISTS "Authenticated CRUD payroll" ON public.payroll;
DROP POLICY IF EXISTS "Authenticated CRUD salary_structures" ON public.salary_structures;

-- user_roles: drop broad read; keep "Users view own roles"
DROP POLICY IF EXISTS "Authenticated read user_roles" ON public.user_roles;

-- Storage: restrict employee photo reads to owner (or super admin)
DROP POLICY IF EXISTS "Authenticated read employee photos" ON storage.objects;
CREATE POLICY "Employees read own photo or super admin"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-photos'
  AND (
    public.is_super_admin(auth.uid())
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.employees WHERE user_id = auth.uid()
    )
  )
);
