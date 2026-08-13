-- Deleting a cancelled/pending delivery fired trg_deliveries_recalc_earnings
-- with earn_date = (NULL delivered_at)::date, then INSERT driver_earnings_daily
-- violated earn_date NOT NULL (23502). Skip recalc when there is no date.

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
    v_earn_date := COALESCE(
      (NEW.delivered_at AT TIME ZONE 'Asia/Kuwait')::date,
      (OLD.delivered_at AT TIME ZONE 'Asia/Kuwait')::date
    );
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_driver_id IS NULL OR v_earn_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM public.recalculate_driver_earnings(v_driver_id, v_earn_date);
  RETURN COALESCE(NEW, OLD);
END;
$$;
