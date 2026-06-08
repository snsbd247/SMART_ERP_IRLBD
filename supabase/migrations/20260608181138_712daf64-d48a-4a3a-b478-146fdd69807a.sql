-- Add Bill Submit stage to Sales Invoice workflow
ALTER TABLE public.sales_invoices_v2
  ADD COLUMN IF NOT EXISTS bill_submitted_at date NULL,
  ADD COLUMN IF NOT EXISTS bill_due_date date NULL,
  ADD COLUMN IF NOT EXISTS bill_submission_ref text NULL,
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 30;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_v2_bill_due ON public.sales_invoices_v2(bill_due_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_v2_bill_submitted ON public.sales_invoices_v2(bill_submitted_at);