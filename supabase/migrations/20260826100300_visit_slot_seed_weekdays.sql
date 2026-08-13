-- Seed weekday morning/afternoon visit slots for Central Tower (all primary depts).
-- Capacity 2 per slot so User App can book during QA.

INSERT INTO public.visit_slots (
  branch_id, department_key, day_of_week, start_time, end_time, capacity, is_active
)
SELECT
  b.id,
  d.key,
  dow.day_of_week,
  t.start_time,
  t.end_time,
  2,
  true
FROM public.visit_branches b
CROSS JOIN public.visit_departments d
CROSS JOIN (VALUES (0), (1), (2), (3), (4)) AS dow(day_of_week) -- Sun–Thu
CROSS JOIN (
  VALUES
    (time '09:00', time '09:30'),
    (time '10:00', time '10:30'),
    (time '11:00', time '11:30'),
    (time '14:00', time '14:30')
) AS t(start_time, end_time)
WHERE b.key = 'central_tower'
  AND d.key IN (
    'hr_services', 'legal', 'operations_services', 'exit_process',
    'documents_signatures', 'training', 'meeting_request', 'other'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.visit_slots s
    WHERE s.branch_id = b.id
      AND s.department_key = d.key
      AND s.day_of_week = dow.day_of_week
      AND s.start_time = t.start_time
      AND s.end_time = t.end_time
  );
