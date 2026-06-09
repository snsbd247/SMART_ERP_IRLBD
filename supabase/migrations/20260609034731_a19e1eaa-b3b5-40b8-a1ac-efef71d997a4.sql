
-- Create missing stock_adjustments table used by StockAdjustmentPage
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number text NOT NULL UNIQUE,
  adjustment_date date NOT NULL DEFAULT CURRENT_DATE,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('increase','decrease')),
  product_id uuid NOT NULL,
  warehouse_id uuid,
  branch_id uuid,
  quantity numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  total_value numeric(18,4) NOT NULL DEFAULT 0,
  reason text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view stock adjustments"
  ON public.stock_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage stock adjustments"
  ON public.stock_adjustments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed the number sequence
INSERT INTO public.number_sequences (id, prefix, current_number, year)
VALUES ('stock_adjustment','STA',0, EXTRACT(YEAR FROM CURRENT_DATE)::int)
ON CONFLICT (id) DO NOTHING;
