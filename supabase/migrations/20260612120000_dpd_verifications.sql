-- DPD delivery verifications: restaurant-reported counts vs driver-entered deliveries.

DO $$ BEGIN
  ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'under_review';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM (
    'pending',
    'matched',
    'surplus',
    'deficit',
    'conflict',
    'reverted'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.verification_source AS ENUM ('manual', 'import');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.verification_import_batch_status AS ENUM (
    'previewed',
    'applied',
    'reverted'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS employee_id text;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_employee_id_unique
  ON public.drivers (employee_id)
  WHERE employee_id IS NOT NULL;

COMMENT ON COLUMN public.drivers.employee_id IS
  'Restaurant report Emp ID; used to match bulk verification imports.';

CREATE TABLE IF NOT EXISTS public.verification_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count int NOT NULL DEFAULT 0,
  applied_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  status public.verification_import_batch_status NOT NULL DEFAULT 'previewed',
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.delivery_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  reported_count int NOT NULL CHECK (reported_count >= 0),
  matched_count int NOT NULL DEFAULT 0,
  under_review_count int NOT NULL DEFAULT 0,
  shortfall_count int NOT NULL DEFAULT 0,
  status public.verification_status NOT NULL DEFAULT 'pending',
  source public.verification_source NOT NULL DEFAULT 'manual',
  import_batch_id uuid REFERENCES public.verification_import_batches(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  CONSTRAINT delivery_verifications_unique_day
    UNIQUE (driver_id, restaurant_id, service_date)
);

CREATE INDEX IF NOT EXISTS delivery_verifications_service_date_idx
  ON public.delivery_verifications (service_date DESC, driver_id);

CREATE INDEX IF NOT EXISTS delivery_verifications_restaurant_date_idx
  ON public.delivery_verifications (restaurant_id, service_date DESC);

CREATE INDEX IF NOT EXISTS delivery_verifications_import_batch_idx
  ON public.delivery_verifications (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.verification_balances (
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  balance_count int NOT NULL DEFAULT 0 CHECK (balance_count >= 0),
  last_verification_id uuid REFERENCES public.delivery_verifications(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, restaurant_id)
);

COMMENT ON TABLE public.delivery_verifications IS
  'Restaurant-confirmed delivery counts per driver/restaurant/day; triggers auto-reconcile.';

COMMENT ON TABLE public.verification_balances IS
  'Carry-over when restaurant reported more deliveries than the driver logged.';

-- Reconcile driver deliveries for one verification row.
CREATE OR REPLACE FUNCTION public.reconcile_delivery_verification(p_verification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.delivery_verifications%ROWTYPE;
  v_delivery_ids uuid[];
  v_actual int;
  v_take int;
  v_excess int;
  v_shortfall int;
  v_new_status public.verification_status;
BEGIN
  SELECT * INTO v_row
  FROM public.delivery_verifications
  WHERE id = p_verification_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification_not_found';
  END IF;

  IF v_row.status = 'reverted' THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(d.id ORDER BY d.delivered_at ASC), '{}')
  INTO v_delivery_ids
  FROM public.deliveries d
  WHERE d.driver_id = v_row.driver_id
    AND (d.delivered_at AT TIME ZONE 'Asia/Kuwait')::date = v_row.service_date
    AND (
      d.restaurant_id = v_row.restaurant_id
      OR (
        d.restaurant_id IS NULL
        AND d.partner_id = v_row.partner_id
      )
    )
    AND d.status IS DISTINCT FROM 'rejected';

  v_actual := COALESCE(array_length(v_delivery_ids, 1), 0);
  v_take := LEAST(v_row.reported_count, v_actual);
  v_excess := GREATEST(v_actual - v_row.reported_count, 0);
  v_shortfall := GREATEST(v_row.reported_count - v_actual, 0);

  IF v_actual = 0 AND v_row.reported_count = 0 THEN
    v_new_status := 'matched';
  ELSIF v_excess > 0 THEN
    v_new_status := 'surplus';
  ELSIF v_shortfall > 0 THEN
    v_new_status := 'deficit';
  ELSE
    v_new_status := 'matched';
  END IF;

  IF v_actual > 0 THEN
    UPDATE public.deliveries d
    SET status = 'pending', updated_at = now()
    WHERE d.id = ANY (v_delivery_ids);

    IF v_take > 0 THEN
      UPDATE public.deliveries d
      SET status = 'verified', updated_at = now()
      WHERE d.id = ANY (v_delivery_ids[1:v_take]);
    END IF;

    IF v_excess > 0 THEN
      UPDATE public.deliveries d
      SET status = 'under_review', updated_at = now()
      WHERE d.id = ANY (v_delivery_ids[v_take + 1:v_actual]);
    END IF;
  END IF;

  IF v_shortfall > 0 THEN
    INSERT INTO public.verification_balances (driver_id, restaurant_id, balance_count, last_verification_id, updated_at)
    VALUES (v_row.driver_id, v_row.restaurant_id, v_shortfall, v_row.id, now())
    ON CONFLICT (driver_id, restaurant_id) DO UPDATE
    SET
      balance_count = public.verification_balances.balance_count + EXCLUDED.balance_count,
      last_verification_id = EXCLUDED.last_verification_id,
      updated_at = now();
  END IF;

  UPDATE public.delivery_verifications
  SET
    matched_count = v_take,
    under_review_count = v_excess,
    shortfall_count = v_shortfall,
    status = v_new_status,
    reconciled_at = now(),
    updated_at = now()
  WHERE id = p_verification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_delivery_verifications_reconcile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.reconcile_delivery_verification(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_verifications_reconcile ON public.delivery_verifications;
CREATE TRIGGER delivery_verifications_reconcile
  AFTER INSERT OR UPDATE OF reported_count, driver_id, restaurant_id, service_date
  ON public.delivery_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_delivery_verifications_reconcile();

-- RLS
ALTER TABLE public.delivery_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_delivery_verifications_select ON public.delivery_verifications;
CREATE POLICY staff_delivery_verifications_select ON public.delivery_verifications
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_delivery_verifications_insert ON public.delivery_verifications;
CREATE POLICY staff_delivery_verifications_insert ON public.delivery_verifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_delivery_verifications_update ON public.delivery_verifications;
CREATE POLICY staff_delivery_verifications_update ON public.delivery_verifications
  FOR UPDATE TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS delivery_verifications_super_admin_delete ON public.delivery_verifications;
CREATE POLICY delivery_verifications_super_admin_delete ON public.delivery_verifications
  FOR DELETE TO authenticated
  USING (public.is_super_admin_user());

DROP POLICY IF EXISTS staff_verification_balances_select ON public.verification_balances;
CREATE POLICY staff_verification_balances_select ON public.verification_balances
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_verification_balances_all ON public.verification_balances;
CREATE POLICY staff_verification_balances_all ON public.verification_balances
  FOR ALL TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_verification_import_batches_select ON public.verification_import_batches;
CREATE POLICY staff_verification_import_batches_select ON public.verification_import_batches
  FOR SELECT TO authenticated
  USING (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_verification_import_batches_insert ON public.verification_import_batches;
CREATE POLICY staff_verification_import_batches_insert ON public.verification_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_panel_user());

DROP POLICY IF EXISTS staff_verification_import_batches_update ON public.verification_import_batches;
CREATE POLICY staff_verification_import_batches_update ON public.verification_import_batches
  FOR UPDATE TO authenticated
  USING (public.is_admin_panel_user())
  WITH CHECK (public.is_admin_panel_user());
