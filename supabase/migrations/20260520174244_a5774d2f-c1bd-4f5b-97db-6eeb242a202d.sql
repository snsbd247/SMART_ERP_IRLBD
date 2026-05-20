
-- Extend BOM with serial number, UOM, rates
ALTER TABLE public.bill_of_materials
  ADD COLUMN IF NOT EXISTS bom_number text,
  ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES public.units(id),
  ADD COLUMN IF NOT EXISTS previous_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_rate numeric DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS bill_of_materials_bom_number_uidx
  ON public.bill_of_materials(bom_number) WHERE bom_number IS NOT NULL;

-- Extend bom_items with wastage + price
ALTER TABLE public.bom_items
  ADD COLUMN IF NOT EXISTS wastage_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0;

-- Expenses per BOM (linked to chart_of_accounts expense accounts)
CREATE TABLE IF NOT EXISTS public.bom_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES public.bill_of_materials(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.chart_of_accounts(id),
  rate numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bom_expenses_bom_id_idx ON public.bom_expenses(bom_id);

ALTER TABLE public.bom_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bom_expenses all access" ON public.bom_expenses;
CREATE POLICY "bom_expenses all access" ON public.bom_expenses FOR ALL USING (true) WITH CHECK (true);

-- Seed BOM number sequence
INSERT INTO public.number_sequences (id, prefix, current_number, year, description)
VALUES ('bom', 'BOM', 0, 2425, 'Bill of Materials')
ON CONFLICT (id) DO NOTHING;
