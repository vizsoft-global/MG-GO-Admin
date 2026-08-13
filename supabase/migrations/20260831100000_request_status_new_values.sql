-- Three status chips exist in Figma with nothing behind them. The client confirmed all three,
-- with these semantics:
--   rescheduled - an approver proposed different dates. Not terminal: the step stays open and
--                 the rider is asked to accept, which returns the request to in_review.
--   responded   - the send_response action on a complaint or salary justification. Terminal,
--                 stamps completed_at, counts as resolved in the KPI.
--   closed      - archive after a decision. Set by staff, or automatically once a completed
--                 request is older than app_settings.request_auto_close_days.
--
-- Enum values must be committed before anything can reference them, so this migration adds
-- them and nothing else. The workflow that uses them lands in 20260831100200.

ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'rescheduled';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'responded';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'closed';
