
-- Add TIN to parties + snapshot fields to treasury_entries (Safe Extension Only)
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS tin_no varchar(50);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tin_no varchar(50);
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tin_no varchar(50);

ALTER TABLE public.treasury_entries ADD COLUMN IF NOT EXISTS tin_snapshot varchar(50);
ALTER TABLE public.treasury_entries ADD COLUMN IF NOT EXISTS designation_snapshot varchar(150);
ALTER TABLE public.treasury_entries ADD COLUMN IF NOT EXISTS branch_name_snapshot varchar(150);
ALTER TABLE public.treasury_entries ADD COLUMN IF NOT EXISTS challan_base_amount numeric(18,2);
