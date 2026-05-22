CREATE TABLE IF NOT EXISTS public.ifrs_account_mapping (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE,
  ifrs_line text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ifrs_account_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read ifrs_account_mapping"
  ON public.ifrs_account_mapping FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Super admins manage ifrs_account_mapping"
  ON public.ifrs_account_mapping FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_ifrs_account_mapping_line ON public.ifrs_account_mapping(ifrs_line);