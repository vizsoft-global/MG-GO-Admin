-- EmployeeDesk V2 — the recipient stage the tracker draws (F7).
--
-- The reference's Sent-for-signature list carries four recipient states —
-- `Not opened`, `Opened, not signed`, `Declined`, `Signed` — and this schema has
-- three columns that can produce them: `status`, `viewed_at` and `due_at`. The
-- distinction the fourth state adds is the one the operator acts on: a rider who
-- opened the document and did not sign it needs a reminder, and a rider who has
-- not opened it at all needs a phone call. Adding an enum member for it would
-- rewrite the meaning of every existing filter, KPI and CSV column, so the stage
-- is derived on read instead — exactly as `esign-recipient-stage.ts` derives it
-- on the client, which is the property that keeps the two agreeing.
--
-- `display_status` is left **byte-identical**. It is what every V1 screen reads
-- as the row's `status`, and folding `opened` into it would put a value in the
-- rider's status pill that the `EsignRequestStatus` union does not contain. The
-- new `recipient_stage` column rides alongside it, and `p_status` accepts the two
-- derived values as their own branch so a filter narrows the rows without
-- changing what a row says it is.
--
-- The page filter is applied inside the paged subquery, not over the finished
-- page: filtering after LIMIT would return a page of 50 and then hide most of
-- it, which reads as a broken screen rather than an empty one.

CREATE OR REPLACE FUNCTION public.admin_list_esign_requests(
  p_status text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_panel_user() OR NOT public.staff_has_permission('requests.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  PERFORM public.admin_expire_esign_requests();

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC)
      FROM (
        SELECT *
        FROM (
          SELECT e.*,
                 p.full_name AS driver_name,
                 d.driver_code,
                 c.label_en AS category_label,
                 CASE
                   WHEN e.status = 'pending'
                        AND e.due_at IS NOT NULL
                        AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                   THEN 'expired'
                   ELSE e.status::text
                 END AS display_status,
                 -- Same precedence as the client helper, and in the same order:
                 -- a terminal status wins, then expiry, then the `viewed_at`
                 -- test. An overdue-but-unopened row is `expired`, not
                 -- `not_opened` — it is no longer the operator's outstanding
                 -- work, and counting it as waiting is what would make the
                 -- Waiting tile and the rows underneath it disagree.
                 CASE
                   WHEN e.status <> 'pending' THEN e.status::text
                   WHEN e.due_at IS NOT NULL
                        AND e.due_at < (timezone('Asia/Kuwait', now()))::date
                   THEN 'expired'
                   WHEN e.viewed_at IS NOT NULL THEN 'opened'
                   ELSE 'not_opened'
                 END AS recipient_stage
          FROM public.esign_requests e
          LEFT JOIN public.drivers d ON d.id = e.driver_id
          LEFT JOIN public.profiles p ON p.id = e.driver_id
          LEFT JOIN public.esign_categories c ON c.key = e.category_key
        ) s
        WHERE (
          p_status IS NULL
          OR (
            p_status IN ('opened', 'not_opened')
            AND s.recipient_stage = p_status
          )
          OR (
            p_status NOT IN ('opened', 'not_opened')
            AND s.display_status = p_status
          )
        )
        ORDER BY s.created_at DESC
        LIMIT GREATEST(COALESCE(p_limit, 50), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
      ) b
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_esign_requests(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_esign_requests(text, int, int) TO authenticated, service_role;
