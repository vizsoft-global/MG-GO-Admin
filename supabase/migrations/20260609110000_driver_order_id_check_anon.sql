-- Order ID availability check is safe to run without auth (returns only true/false).

CREATE OR REPLACE FUNCTION public.driver_check_order_id_available(p_external_order_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_exists boolean;
BEGIN
  v_norm := public.normalize_external_order_id(p_external_order_id);
  IF v_norm IS NULL OR v_norm = '' THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE public.normalize_external_order_id(d.external_order_id) = v_norm
  ) INTO v_exists;

  RETURN NOT v_exists;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_check_order_id_available(text) TO anon;
GRANT EXECUTE ON FUNCTION public.driver_check_order_id_available(text) TO authenticated;
