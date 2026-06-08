
-- Soft delete columns for sales_invoices_v2 (already has deleted_at)
ALTER TABLE public.sales_invoices_v2
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS prev_status text;
CREATE INDEX IF NOT EXISTS idx_sales_invoices_v2_deleted_at ON public.sales_invoices_v2(deleted_at);

-- Soft delete columns for purchases
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS prev_status text;
CREATE INDEX IF NOT EXISTS idx_purchases_deleted_at ON public.purchases(deleted_at);

-- Soft delete columns for party_payments (no status column, just deleted_at/by)
ALTER TABLE public.party_payments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;
CREATE INDEX IF NOT EXISTS idx_party_payments_deleted_at ON public.party_payments(deleted_at);
