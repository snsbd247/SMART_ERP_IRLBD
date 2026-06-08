DROP POLICY IF EXISTS "Users view own participation" ON public.conversation_participants;

CREATE POLICY "Users view own participation"
ON public.conversation_participants
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';