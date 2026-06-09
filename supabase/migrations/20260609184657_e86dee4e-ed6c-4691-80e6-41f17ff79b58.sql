DO $$ BEGIN
  -- Clean orphans
  UPDATE public.supplier_bills_v2 SET supplier_id = NULL WHERE supplier_id IS NOT NULL AND supplier_id NOT IN (SELECT id FROM public.suppliers);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='supplier_bills_v2_supplier_id_fkey') THEN
    ALTER TABLE public.supplier_bills_v2 ADD CONSTRAINT supplier_bills_v2_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';