ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS receivable_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_receivable_account ON public.customers(receivable_account_id);