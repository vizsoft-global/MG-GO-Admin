-- Both tables were deliberately created empty because the values had to come from the
-- client, and both gate their rider form: driver_create_request refuses a loan with
-- tenure_options_not_configured and a complaint with complaint_categories_not_configured.
-- The client has now confirmed both lists, so seeding them un-gates loan and complaint
-- requests in the driver app with no code change.
--
-- Arabic labels here are MSA and still owed a Gulf-native review (docs/RCM_VISIT_OPEN_ITEMS.md
-- section B). Nothing renders label_ar yet - the driver app reads label_en only.

INSERT INTO public.loan_tenure_options (months, label, is_active, sort_order)
VALUES
  (3, '3 months', true, 1),
  (6, '6 months', true, 2),
  (9, '9 months', true, 3),
  (12, '12 months', true, 4),
  (18, '18 months', true, 5),
  (24, '24 months', true, 6)
ON CONFLICT (months) DO NOTHING;

INSERT INTO public.complaint_categories (key, label_en, label_ar, is_active, sort_order)
VALUES
  ('payments', 'Payments', 'المدفوعات', true, 1),
  ('salary_issues', 'Salary Issues', 'مشاكل الراتب', true, 2),
  ('attendance_checkin', 'Attendance / Check-in', 'الحضور / تسجيل الدخول', true, 3),
  ('visit_booking_issues', 'Visit / Booking Issues', 'مشاكل الزيارات / الحجز', true, 4),
  ('vehicle_fuel', 'Vehicle / Fuel', 'المركبة / الوقود', true, 5),
  ('hr_workplace', 'HR / Workplace', 'الموارد البشرية / بيئة العمل', true, 6),
  ('document_esign_issues', 'Document / E-Sign Issues', 'مشاكل المستندات / التوقيع الإلكتروني', true, 7),
  ('app_technical_issue', 'App / Technical Issue', 'مشكلة في التطبيق / تقنية', true, 8),
  ('other', 'Other', 'أخرى', true, 9)
ON CONFLICT (key) DO NOTHING;
