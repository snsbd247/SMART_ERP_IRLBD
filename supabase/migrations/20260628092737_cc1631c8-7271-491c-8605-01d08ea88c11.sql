
CREATE TABLE public.treasury_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  treasury_date DATE NOT NULL,
  treasury_type TEXT NOT NULL CHECK (treasury_type IN ('salary_tds','party_tds','vat')),
  party_kind TEXT CHECK (party_kind IN ('employee','customer','supplier','none')),
  party_id UUID,
  party_name_snapshot TEXT,
  challan_no TEXT,
  challan_date DATE,
  bank_name TEXT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  period_month TEXT,
  mushak_ref TEXT,
  reference_no TEXT,
  notes TEXT,
  branch_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_treasury_entries_date ON public.treasury_entries(treasury_date);
CREATE INDEX idx_treasury_entries_type ON public.treasury_entries(treasury_type);
CREATE INDEX idx_treasury_entries_party ON public.treasury_entries(party_kind, party_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_entries TO authenticated;
GRANT ALL ON public.treasury_entries TO service_role;

ALTER TABLE public.treasury_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read treasury entries"
  ON public.treasury_entries FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert treasury entries"
  ON public.treasury_entries FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update treasury entries"
  ON public.treasury_entries FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete treasury entries"
  ON public.treasury_entries FOR DELETE
  TO authenticated USING (true);

CREATE TRIGGER trg_treasury_entries_touch
  BEFORE UPDATE ON public.treasury_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
