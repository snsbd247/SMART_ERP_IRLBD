-- 1. Schema: sections table
CREATE TABLE IF NOT EXISTS public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage sections" ON public.sections
  FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Authenticated read sections" ON public.sections
  FOR SELECT TO authenticated USING (true);

-- 2. employees: section_id + employee_category
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_category text NOT NULL DEFAULT 'staff';
  -- expected values: worker, supervisor, staff, officer

-- 3. Branch lookups for seed
DO $$
DECLARE
  v_ho uuid; v_fac uuid;
  v_prod uuid;
BEGIN
  SELECT id INTO v_ho FROM public.branches WHERE code='HQ' LIMIT 1;
  SELECT id INTO v_fac FROM public.branches WHERE code='FAC' LIMIT 1;

  -- Shifts
  INSERT INTO public.shifts (shift_name, start_time, end_time, late_after_minutes)
  VALUES
    ('Factory Day Shift (12h)', '08:00', '20:00', 15),
    ('Factory Night Shift (12h)', '20:00', '08:00', 15),
    ('Factory Staff', '09:00', '18:00', 15),
    ('Head Office Staff', '10:00', '18:00', 15)
  ON CONFLICT DO NOTHING;

  -- Departments (no branch column in departments, so plain insert)
  INSERT INTO public.departments (name, description, status) VALUES
    ('Administration', 'Head Office - Administration', 'active'),
    ('Accounts', 'Head Office - Accounts & Finance', 'active'),
    ('Sales', 'Head Office - Sales & Marketing', 'active'),
    ('IT', 'Head Office - IT', 'active'),
    ('Production', 'Factory - Production', 'active'),
    ('Quality Control', 'Factory - QC', 'active'),
    ('Store', 'Factory - Store / Warehouse', 'active'),
    ('Maintenance', 'Factory - Maintenance', 'active'),
    ('Factory Admin', 'Factory - Admin & HR', 'active')
  ON CONFLICT DO NOTHING;

  -- Designations
  INSERT INTO public.designations (name, status) VALUES
    ('Worker', 'active'),
    ('Supervisor', 'active'),
    ('Officer', 'active'),
    ('Executive', 'active'),
    ('Manager', 'active'),
    ('Sr. Manager', 'active')
  ON CONFLICT DO NOTHING;

  -- Factory sample sections under Production
  SELECT id INTO v_prod FROM public.departments WHERE name='Production' LIMIT 1;
  INSERT INTO public.sections (name, branch_id, department_id) VALUES
    ('Cutting', v_fac, v_prod),
    ('Sewing', v_fac, v_prod),
    ('Finishing', v_fac, v_prod),
    ('Packing', v_fac, v_prod);

  -- Leave types
  INSERT INTO public.leave_types (name, days_per_year) VALUES
    ('Annual Leave', 14),
    ('Sick Leave', 10),
    ('Casual Leave', 10),
    ('Maternity Leave', 112)
  ON CONFLICT DO NOTHING;
END $$;