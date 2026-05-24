
-- Reset password for admin@erp.com to 'Admin@123'
UPDATE auth.users
SET encrypted_password = crypt('Admin@123', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now(),
    banned_until = NULL
WHERE email = 'admin@erp.com';

-- Create super admin profile (employee_id NULL => super admin)
INSERT INTO public.profiles (id, name, username, email, employee_id, status)
SELECT id, 'System Administrator', 'admin', 'admin@erp.com', NULL, 'active'
FROM auth.users WHERE email = 'admin@erp.com'
ON CONFLICT (id) DO UPDATE SET username = 'admin', employee_id = NULL, status = 'active';
