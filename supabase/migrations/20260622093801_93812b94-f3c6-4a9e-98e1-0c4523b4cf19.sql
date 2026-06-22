ALTER TABLE public.acc_vouchers REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.acc_vouchers;