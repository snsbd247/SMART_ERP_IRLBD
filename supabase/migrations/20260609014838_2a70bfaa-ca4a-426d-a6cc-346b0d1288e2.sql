ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';
CREATE INDEX IF NOT EXISTS idx_employees_approval_status ON public.employees(approval_status);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS approval_notes TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;