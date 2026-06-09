
-- ============================================================
-- PHASE 1: PURCHASE FOUNDATION ARCHITECTURE
-- ============================================================

-- 1. Purchase Types Master
CREATE TABLE public.purchase_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  requires_grn boolean NOT NULL DEFAULT true,
  requires_lc boolean NOT NULL DEFAULT false,
  affects_inventory boolean NOT NULL DEFAULT true,
  affects_asset boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_types TO authenticated;
GRANT ALL ON public.purchase_types TO service_role;
ALTER TABLE public.purchase_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_types_auth_all" ON public.purchase_types FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Suppliers Master
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text,
  supplier_type text NOT NULL DEFAULT 'local', -- local, import, service, asset, utility
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  country text DEFAULT 'Bangladesh',
  tax_id text,
  vat_reg_no text,
  bin_no text,
  credit_limit numeric(18,2) DEFAULT 0,
  credit_days integer DEFAULT 0,
  payment_terms text,
  currency text DEFAULT 'BDT',
  opening_balance numeric(18,2) DEFAULT 0,
  bank_name text,
  bank_account text,
  bank_branch text,
  swift_code text,
  payable_account_id uuid REFERENCES public.chart_of_accounts(id),
  advance_account_id uuid REFERENCES public.chart_of_accounts(id),
  branch_id uuid REFERENCES public.branches(id),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_suppliers_branch ON public.suppliers(branch_id);
CREATE INDEX idx_suppliers_type ON public.suppliers(supplier_type);
CREATE INDEX idx_suppliers_active ON public.suppliers(is_active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_auth_all" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Purchase Settings (singleton)
CREATE TABLE public.purchase_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enforce_grn_for_bill boolean NOT NULL DEFAULT true,
  allow_over_receive boolean NOT NULL DEFAULT false,
  allow_over_bill boolean NOT NULL DEFAULT false,
  default_currency text DEFAULT 'BDT',
  default_vat_percent numeric(5,2) DEFAULT 15,
  default_ait_percent numeric(5,2) DEFAULT 0,
  pr_prefix text DEFAULT 'PR',
  po_prefix text DEFAULT 'PO',
  grn_prefix text DEFAULT 'GRN',
  bill_prefix text DEFAULT 'BILL',
  pay_prefix text DEFAULT 'PAY',
  lc_prefix text DEFAULT 'LC',
  auto_post_grn boolean NOT NULL DEFAULT true,
  auto_post_bill boolean NOT NULL DEFAULT true,
  auto_post_payment boolean NOT NULL DEFAULT true,
  enable_multi_currency boolean NOT NULL DEFAULT false,
  enable_landed_cost boolean NOT NULL DEFAULT true,
  enable_lc_module boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_settings TO authenticated;
GRANT ALL ON public.purchase_settings TO service_role;
ALTER TABLE public.purchase_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_settings_auth_all" ON public.purchase_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Purchase Approval Matrix
CREATE TABLE public.purchase_approval_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL, -- PR, PO, GRN, BILL, PAYMENT
  purchase_type_id uuid REFERENCES public.purchase_types(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  min_amount numeric(18,2) NOT NULL DEFAULT 0,
  max_amount numeric(18,2),
  step_order integer NOT NULL DEFAULT 1,
  approver_role text,
  approver_user_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_matrix_doc ON public.purchase_approval_matrix(document_type, branch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_approval_matrix TO authenticated;
GRANT ALL ON public.purchase_approval_matrix TO service_role;
ALTER TABLE public.purchase_approval_matrix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_matrix_auth_all" ON public.purchase_approval_matrix FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Purchase Audit Log
CREATE TABLE public.purchase_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  document_id uuid NOT NULL,
  document_no text,
  action text NOT NULL, -- CREATED, UPDATED, SUBMITTED, APPROVED, REJECTED, CANCELLED, POSTED
  performed_by uuid,
  performed_by_name text,
  old_value jsonb,
  new_value jsonb,
  notes text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_doc ON public.purchase_audit_log(document_type, document_id);
CREATE INDEX idx_audit_created ON public.purchase_audit_log(created_at DESC);
GRANT SELECT, INSERT ON public.purchase_audit_log TO authenticated;
GRANT ALL ON public.purchase_audit_log TO service_role;
ALTER TABLE public.purchase_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_read" ON public.purchase_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_log_insert" ON public.purchase_audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- 6. Purchase Approval History
CREATE TABLE public.purchase_approval_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  document_id uuid NOT NULL,
  document_no text,
  step_order integer NOT NULL,
  approver_user_id uuid,
  approver_name text,
  status text NOT NULL, -- pending, approved, rejected
  remarks text,
  action_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_history_doc ON public.purchase_approval_history(document_type, document_id);
GRANT SELECT, INSERT, UPDATE ON public.purchase_approval_history TO authenticated;
GRANT ALL ON public.purchase_approval_history TO service_role;
ALTER TABLE public.purchase_approval_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_history_auth_all" ON public.purchase_approval_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. Purchase COA Mapping
CREATE TABLE public.purchase_coa_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_type_id uuid REFERENCES public.purchase_types(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  inventory_account_id uuid REFERENCES public.chart_of_accounts(id),
  grn_clearing_account_id uuid REFERENCES public.chart_of_accounts(id),
  payable_account_id uuid REFERENCES public.chart_of_accounts(id),
  advance_account_id uuid REFERENCES public.chart_of_accounts(id),
  vat_input_account_id uuid REFERENCES public.chart_of_accounts(id),
  ait_account_id uuid REFERENCES public.chart_of_accounts(id),
  asset_account_id uuid REFERENCES public.chart_of_accounts(id),
  expense_account_id uuid REFERENCES public.chart_of_accounts(id),
  discount_account_id uuid REFERENCES public.chart_of_accounts(id),
  freight_account_id uuid REFERENCES public.chart_of_accounts(id),
  landed_cost_account_id uuid REFERENCES public.chart_of_accounts(id),
  cash_account_id uuid REFERENCES public.chart_of_accounts(id),
  bank_account_id uuid REFERENCES public.chart_of_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(purchase_type_id, branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_coa_mapping TO authenticated;
GRANT ALL ON public.purchase_coa_mapping TO service_role;
ALTER TABLE public.purchase_coa_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coa_mapping_auth_all" ON public.purchase_coa_mapping FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_purchase_types_uat BEFORE UPDATE ON public.purchase_types FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_suppliers_uat BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_purchase_settings_uat BEFORE UPDATE ON public.purchase_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_approval_matrix_uat BEFORE UPDATE ON public.purchase_approval_matrix FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_coa_mapping_uat BEFORE UPDATE ON public.purchase_coa_mapping FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 9. Seed default Purchase Types
INSERT INTO public.purchase_types (code, name, is_system, requires_grn, requires_lc, affects_inventory, affects_asset) VALUES
  ('LOCAL',   'Local Purchase',   true, true,  false, true,  false),
  ('IMPORT',  'Import Purchase',  true, true,  true,  true,  false),
  ('ASSET',   'Asset Purchase',   true, true,  false, false, true),
  ('CASH',    'Cash Purchase',    true, true,  false, true,  false),
  ('UTILITY', 'Utility Expense',  true, false, false, false, false),
  ('SERVICE', 'Service Expense',  true, false, false, false, false);

-- 10. Seed default Purchase Settings singleton
INSERT INTO public.purchase_settings (default_currency) VALUES ('BDT');
