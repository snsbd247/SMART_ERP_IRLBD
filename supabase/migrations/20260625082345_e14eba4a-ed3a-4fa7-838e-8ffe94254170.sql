ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS code text;
CREATE UNIQUE INDEX IF NOT EXISTS customers_code_unique ON public.customers (lower(code)) WHERE code IS NOT NULL;