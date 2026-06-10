-- Allow anonymous (login screen) read of public branding settings only.
-- Keeps super-admin-only policy for everything else.
CREATE POLICY "Public read branding system_settings"
ON public.system_settings
FOR SELECT
TO anon, authenticated
USING (
  setting_key IN (
    'software_name','software_version','footer_text','developer_name',
    'white_label_mode','primary_color','secondary_color',
    'company_logo_url','login_logo_url','favicon_url'
  )
);

GRANT SELECT ON public.system_settings TO anon;