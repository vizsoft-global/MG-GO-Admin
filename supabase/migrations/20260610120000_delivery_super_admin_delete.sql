-- Super-admin-only DELETE on deliveries; recalc earnings when verified status toggles or row deleted.

DROP POLICY IF EXISTS staff_all_deliveries ON public.deliveries;

DROP POLICY IF EXISTS staff_deliveries_select ON public.deliveries;
CREATE POLICY staff_deliveries_select ON public.deliveries
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_deliveries_insert ON public.deliveries;
CREATE POLICY staff_deliveries_insert ON public.deliveries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_deliveries_update ON public.deliveries;
CREATE POLICY staff_deliveries_update ON public.deliveries
  FOR UPDATE TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS deliveries_super_admin_delete ON public.deliveries;
CREATE POLICY deliveries_super_admin_delete ON public.deliveries
  FOR DELETE TO authenticated
  USING (public.is_super_admin_user());

-- Recalc earnings when delivery enters or leaves verified, or is removed.
CREATE OR REPLACE FUNCTION public.trg_deliveries_recalc_earnings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_earn_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_driver_id := OLD.driver_id;
    v_earn_date := (OLD.delivered_at AT TIME ZONE 'Asia/Kuwait')::date;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT (
      (NEW.status = 'verified' AND OLD.status IS DISTINCT FROM 'verified')
      OR (OLD.status = 'verified' AND NEW.status IS DISTINCT FROM 'verified')
    ) THEN
      RETURN NEW;
    END IF;
    v_driver_id := NEW.driver_id;
    v_earn_date := (NEW.delivered_at AT TIME ZONE 'Asia/Kuwait')::date;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM public.recalculate_driver_earnings(v_driver_id, v_earn_date);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS deliveries_recalc_earnings ON public.deliveries;
CREATE TRIGGER deliveries_recalc_earnings
  AFTER UPDATE OF status ON public.deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deliveries_recalc_earnings();

DROP TRIGGER IF EXISTS deliveries_recalc_earnings_delete ON public.deliveries;
CREATE TRIGGER deliveries_recalc_earnings_delete
  AFTER DELETE ON public.deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deliveries_recalc_earnings();
