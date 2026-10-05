-- EmployeeDesk V2 — the rider's inbox speaks the same recipient vocabulary the
-- operator's tracker does (F7).
--
-- `20261116000400` gave the **admin** list a `recipient_stage` so the Sent-for-
-- signature tracker could draw `Not opened` beside `Opened, not signed`. The
-- rider's own inbox has the same question and, until now, the same blindness:
-- `driver_list_esign_requests` returned neither `viewed_at` nor a derived stage,
-- so the app could only say "Pending" for both a document the rider has never
-- seen and one they opened and walked away from.
--
-- The payload change is **additive**: `viewed_at` and `recipient_stage` join the
-- selected columns and nothing else moves — not the filters, not the ordering,
-- not the `expired` remap that `20260931100000` established on `status`. That
-- remap stays authoritative for the status pill, which is why the stage is
-- derived *before* the expiry branch is applied to `status` and follows the same
-- precedence the admin RPC and `esign-recipient-stage.ts` use:
--
--   terminal status → expiry → viewed_at → not opened
--
-- An overdue unopened document is `expired`, not `not_opened`: it is no longer
-- outstanding work, and counting it as waiting would inflate the very bucket the
-- sub-filter exists to isolate.
--
-- The stage is derived on read, deliberately. A stored column would need a
-- trigger on each of the four transitions and would be wrong for every row
-- written before the trigger existed; the inputs are columns already on the row.
--
-- The GRANT is re-applied after the CREATE OR REPLACE: replacing a function
-- preserves its ACL, but the block is here so a future DROP + recreate in this
-- ledger does not silently lose the rider's execute right.

CREATE OR REPLACE FUNCTION public.driver_list_esign_requests(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY
        CASE WHEN x.status = 'pending' THEN 0 ELSE 1 END,
        x.created_at DESC)
      FROM (
        SELECT e.id, e.request_code, e.title,
               CASE
                 WHEN e.status = 'pending'
                      AND e.due_at IS NOT NULL
                      AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                 THEN 'expired'
                 ELSE e.status::text
               END AS status,
               e.due_at, e.signed_at, e.viewed_at,
               -- Same precedence as the admin RPC and the client helper.
               CASE
                 WHEN e.status <> 'pending' THEN e.status::text
                 WHEN e.due_at IS NOT NULL
                      AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                 THEN 'expired'
                 WHEN e.viewed_at IS NOT NULL THEN 'opened'
                 ELSE 'not_opened'
               END AS recipient_stage,
               COALESCE(c.screenshot_restricted, e.screenshot_restricted)
                 AS screenshot_restricted,
               e.category_key, c.label_en AS category_label,
               e.created_at
        FROM public.esign_requests e
        LEFT JOIN public.esign_categories c ON c.key = e.category_key
        WHERE e.driver_id = v_uid
        ORDER BY CASE
          WHEN e.status = 'pending'
               AND NOT (
                 e.due_at IS NOT NULL
                 AND e.due_at < (timezone('Asia/Kuwait', now()))::date
               )
          THEN 0 ELSE 1 END,
          e.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_list_esign_requests(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_list_esign_requests(int, int) TO authenticated, service_role;
