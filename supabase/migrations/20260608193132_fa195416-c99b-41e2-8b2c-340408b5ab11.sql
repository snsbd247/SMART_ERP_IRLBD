UPDATE auth.users
SET encrypted_password = crypt('Admin@123', gen_salt('bf')),
    updated_at = now()
WHERE id = '7c0c8dfb-c23d-4fd9-9d67-d8322bd0eedb';