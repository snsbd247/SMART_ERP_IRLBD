
-- Voucher Type Change (Transfer) support
-- 1) Free-list for released serial numbers so they can be reused by next entry.
-- 2) Extra columns on acc_vouchers: source_module (block auto-posted from transfer),
--    transferred_to_id / transferred_from_id (audit trail linkage),
--    transfer_reason.

CREATE TABLE IF NOT EXISTS public.number_sequence_free_list (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id TEXT NOT NULL,
  number TEXT NOT NULL,
  released_by UUID NULL,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_nsfl_seq_avail
  ON public.number_sequence_free_list (sequence_id, released_at)
  WHERE consumed_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.number_sequence_free_list TO authenticated;
GRANT ALL ON public.number_sequence_free_list TO service_role;
ALTER TABLE public.number_sequence_free_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read free-list"
  ON public.number_sequence_free_list FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "authenticated write free-list"
  ON public.number_sequence_free_list FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update free-list"
  ON public.number_sequence_free_list FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.acc_vouchers
  ADD COLUMN IF NOT EXISTS source_module TEXT NULL,
  ADD COLUMN IF NOT EXISTS transferred_to_id UUID NULL,
  ADD COLUMN IF NOT EXISTS transferred_from_id UUID NULL,
  ADD COLUMN IF NOT EXISTS transfer_reason TEXT NULL;
