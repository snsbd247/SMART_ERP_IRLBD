
-- Master tables
CREATE TABLE IF NOT EXISTS public.stock_voucher_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  effect text NOT NULL DEFAULT 'in', -- in/out/transfer
  prefix text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_voucher_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage stock_voucher_types" ON public.stock_voucher_types FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Authenticated read stock_voucher_types" ON public.stock_voucher_types FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.mfg_processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mfg_processes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage mfg_processes" ON public.mfg_processes FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Authenticated read mfg_processes" ON public.mfg_processes FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.stock_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  batch_no text NOT NULL,
  mfg_date date,
  exp_date date,
  quantity numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage stock_batches" ON public.stock_batches FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Authenticated read stock_batches" ON public.stock_batches FOR SELECT TO authenticated USING (true);

-- Transaction tables (header + items)
CREATE TABLE IF NOT EXISTS public.consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  branch_id uuid,
  warehouse_id uuid,
  notes text,
  status text NOT NULL DEFAULT 'posted',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.consumption_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.consumption_entries(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0
);
ALTER TABLE public.consumption_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage consumption_entries" ON public.consumption_entries FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Super admins manage consumption_items" ON public.consumption_items FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.finished_goods_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  branch_id uuid,
  warehouse_id uuid,
  product_id uuid NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'posted',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finished_goods_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage finished_goods_entries" ON public.finished_goods_entries FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.stock_damage_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  branch_id uuid,
  warehouse_id uuid,
  reason text,
  status text NOT NULL DEFAULT 'posted',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.stock_damage_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.stock_damage_entries(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0
);
ALTER TABLE public.stock_damage_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_damage_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage stock_damage_entries" ON public.stock_damage_entries FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Super admins manage stock_damage_items" ON public.stock_damage_items FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.physical_stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  branch_id uuid,
  warehouse_id uuid,
  notes text,
  status text NOT NULL DEFAULT 'posted',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.physical_stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.physical_stock_entries(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  system_qty numeric NOT NULL DEFAULT 0,
  counted_qty numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0
);
ALTER TABLE public.physical_stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.physical_stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage physical_stock_entries" ON public.physical_stock_entries FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Super admins manage physical_stock_items" ON public.physical_stock_items FOR ALL TO authenticated USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- Seed number sequences for the new transactions
INSERT INTO public.number_sequences (id, prefix, current_number, year, description) VALUES
  ('consumption', 'CONS', 0, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'Consumption Voucher'),
  ('finished_goods', 'FG', 0, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'Finished Goods Voucher'),
  ('stock_damage', 'DMG', 0, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'Stock Damage Voucher'),
  ('physical_stock', 'PHY', 0, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'Physical Stock Voucher')
ON CONFLICT (id) DO NOTHING;
