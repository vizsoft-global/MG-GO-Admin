CREATE OR REPLACE FUNCTION public.is_rider()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'rider'::public.app_role
      AND p.archived_at IS NULL
  );
$$;
