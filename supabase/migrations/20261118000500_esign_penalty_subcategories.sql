-- RCM outgoing tiles + Penalty dropdown. parent_key is additive; existing
-- categories stay roots. The eight hub keys and the five penalty children
-- are seeded idempotently by key.

ALTER TABLE public.esign_categories
  ADD COLUMN IF NOT EXISTS parent_key text REFERENCES public.esign_categories(key);

INSERT INTO public.esign_categories (key, label_en, description, icon_key, screenshot_restricted, sort_order)
VALUES
  ('loan', 'Loan', 'Loan request for e-signature', 'L', true, 10),
  ('payslip', 'Payslip', 'Payslip for e-signature', 'P', true, 20),
  ('asset', 'Asset', 'Asset handover or recovery', 'A', true, 30),
  ('leave', 'Leave', 'Leave request for e-signature', 'Lv', false, 40),
  ('penalty', 'Penalty', 'Penalty notice — pick a category', 'Pn', true, 50),
  ('investigation', 'Investigation', 'Investigation notice', 'I', true, 60),
  ('accident', 'Accident', 'Accident report for e-signature', 'Ac', true, 70),
  ('general_doc', 'General Doc', 'General document for e-signature', 'G', false, 80)
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.esign_categories (key, label_en, description, icon_key, screenshot_restricted, sort_order, parent_key)
VALUES
  ('late_attendance', 'Late attendance', 'Penalty — late attendance', 'Pn', true, 51, 'penalty'),
  ('unauthorised_absence', 'Unauthorised absence', 'Penalty — unauthorised absence', 'Pn', true, 52, 'penalty'),
  ('written_warning', 'Written warning', 'Penalty — written warning', 'Pn', true, 53, 'penalty'),
  ('damage_to_property', 'Damage to company property', 'Penalty — damage to company property', 'Pn', true, 54, 'penalty'),
  ('penalty_others', 'Others', 'Penalty — other', 'Pn', true, 55, 'penalty')
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  description = EXCLUDED.description,
  parent_key = EXCLUDED.parent_key,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
