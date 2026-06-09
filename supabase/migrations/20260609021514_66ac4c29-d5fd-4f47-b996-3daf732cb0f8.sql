ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS bin_number TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS bin_number TEXT;