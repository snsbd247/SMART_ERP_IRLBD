
-- 1) conversations: drop overly permissive ALL policy; restrict UPDATE/DELETE to participants or super admin
DROP POLICY IF EXISTS "Authenticated CRUD conversations" ON public.conversations;

CREATE POLICY "Authenticated can create conversations"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Participants can update conversations"
ON public.conversations
FOR UPDATE
TO authenticated
USING (
  id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Participants can delete conversations"
ON public.conversations
FOR DELETE
TO authenticated
USING (
  id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  OR public.is_super_admin(auth.uid())
);

-- 2) login_logs: allow authenticated users to insert their own log rows
CREATE POLICY "Users can insert own login logs"
ON public.login_logs
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 3) employee-photos storage bucket: scoped INSERT/UPDATE/DELETE for the owning employee
CREATE POLICY "Employees upload own photo"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-photos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.employees WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Employees update own photo"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'employee-photos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.employees WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'employee-photos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.employees WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Employees delete own photo"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-photos'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.employees WHERE user_id = auth.uid()
  )
);
