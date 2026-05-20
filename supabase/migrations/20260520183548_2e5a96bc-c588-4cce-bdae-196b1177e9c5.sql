
CREATE TABLE IF NOT EXISTS public.stock_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_id uuid REFERENCES public.stock_groups(id) ON DELETE SET NULL,
  primary_group_id uuid REFERENCES public.stock_groups(id) ON DELETE SET NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_groups_parent ON public.stock_groups(parent_id);
CREATE INDEX IF NOT EXISTS idx_stock_groups_primary ON public.stock_groups(primary_group_id);

ALTER TABLE public.item_master
  ADD COLUMN IF NOT EXISTS stock_group_id uuid REFERENCES public.stock_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_item_master_stock_group ON public.item_master(stock_group_id);

ALTER TABLE public.stock_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read stock_groups"
  ON public.stock_groups FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Super admin manage stock_groups"
  ON public.stock_groups FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- Seed a few starter groups (idempotent on name)
INSERT INTO public.stock_groups (name, parent_id, primary_group_id, is_default)
SELECT v.name, NULL, NULL, v.is_default
FROM (VALUES
  ('Finished Goods', true),
  ('Direct Raw Materials', true),
  ('Indirect Raw Materials', false)
) AS v(name, is_default)
WHERE NOT EXISTS (SELECT 1 FROM public.stock_groups sg WHERE sg.name = v.name);

-- Set primary_group_id = self for root groups that don't have one
UPDATE public.stock_groups SET primary_group_id = id WHERE primary_group_id IS NULL AND parent_id IS NULL;
