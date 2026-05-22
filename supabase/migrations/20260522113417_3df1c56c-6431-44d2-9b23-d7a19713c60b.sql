INSERT INTO public.branches (code, name, phone, address, status)
VALUES ('FAC', 'Factory', '', '', 'active')
ON CONFLICT DO NOTHING;