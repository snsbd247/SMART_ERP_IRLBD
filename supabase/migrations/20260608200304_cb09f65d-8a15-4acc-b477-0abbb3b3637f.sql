
ALTER TABLE public.acc_vouchers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS prev_status text;

CREATE INDEX IF NOT EXISTS idx_acc_vouchers_deleted_at ON public.acc_vouchers(deleted_at);
