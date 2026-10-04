-- The e-sign schema shipped on 2026-10-27 with no templates, so every category
-- opened on an empty template list and a sender had to build the loan
-- agreement (and everything else) from scratch. This seeds one editable
-- starting template per category, EN + AR, plus its fields.
--
-- Idempotent by name, not by id: there is no unique constraint on
-- (category_key, name_en), and an admin who edits a seeded template must not
-- get a second copy on the next deploy. The guard is "no template in this
-- category already has this name".
--
-- Field keys must satisfy `esign_template_fields_key_format` and must avoid the
-- seven employee-snapshot keys the table refuses. `{{token}}` in the header,
-- body and declaration resolves against the employee snapshot merged with the
-- field values (see src/features/esign/render/esign-placeholders.ts), so a
-- seeded body can reference its own fields.

WITH seed (
  category_key, name_en, name_ar,
  header_en, header_ar, body_en, body_ar,
  declaration_en, declaration_ar
) AS (
  VALUES
    (
      'accommodation',
      'Accommodation Deduction Acknowledgement',
      'إقرار خصم بدل السكن',
      'Accommodation Deduction Acknowledgement',
      'إقرار خصم بدل السكن',
      'This document confirms the accommodation arrangement between {{company_name}} and {{employee_name}} (Employee ID {{employee_id}}, Driver ID {{driver_code}}). The rider occupies {{property_name}} located at {{property_address}} and the monthly accommodation amount is KD {{monthly_rent_kwd}}.',
      'يؤكد هذا المستند ترتيب السكن بين {{company_name}} والموظف {{employee_name}} (رقم الموظف {{employee_id}}، رقم السائق {{driver_code}}). يشغل السائق {{property_name}} الواقع في {{property_address}} وتبلغ قيمة السكن الشهرية {{monthly_rent_kwd}} د.ك.',
      'I, {{employee_name}}, acknowledge the accommodation details above and the monthly deduction of KD {{deduction_amount_kwd}} from my salary starting from {{effective_month}}.',
      'أقر أنا {{employee_name}} بصحة تفاصيل السكن المذكورة أعلاه وبخصم مبلغ {{deduction_amount_kwd}} د.ك شهرياً من راتبي اعتباراً من {{effective_month}}.'
    ),
    (
      'salary_slips',
      'Salary Deduction Acknowledgement',
      'إقرار خصم من الراتب',
      'Salary Deduction Acknowledgement',
      'إقرار خصم من الراتب',
      'Salary slip for {{employee_name}} (Employee ID {{employee_id}}) — {{slip_month}}. Gross salary: KD {{gross_salary_kwd}}. Deduction: KD {{deduction_amount_kwd}}. Net after deduction: KD {{net_salary_kwd}}.',
      'قسيمة راتب {{employee_name}} (رقم الموظف {{employee_id}}) — {{slip_month}}. الراتب الإجمالي: {{gross_salary_kwd}} د.ك. الخصم: {{deduction_amount_kwd}} د.ك. الصافي بعد الخصم: {{net_salary_kwd}} د.ك.',
      'I, {{employee_name}}, acknowledge the deduction of KD {{deduction_amount_kwd}} shown on this slip. Reason: {{deduction_reason}}.',
      'أقر أنا {{employee_name}} بالخصم البالغ {{deduction_amount_kwd}} د.ك الوارد في هذه القسيمة. السبب: {{deduction_reason}}.'
    ),
    (
      'administrative',
      'Administrative Memo Acknowledgement',
      'إقرار باستلام تعميم إداري',
      'Administrative Memo Acknowledgement',
      'إقرار باستلام تعميم إداري',
      'Memo {{memo_reference}} — {{memo_subject}}, issued to {{employee_name}} (Employee ID {{employee_id}}) on {{issue_date}}. Content: {{memo_body}}',
      'التعميم {{memo_reference}} — {{memo_subject}}، الصادر إلى {{employee_name}} (رقم الموظف {{employee_id}}) بتاريخ {{issue_date}}. النص: {{memo_body}}',
      'I, {{employee_name}}, confirm that I have read this memo and received a copy of it.',
      'أقر أنا {{employee_name}} بأنني قرأت هذا التعميم واستلمت نسخة منه.'
    ),
    (
      'asset_docs',
      'Asset Damage or Penalty Acknowledgement',
      'إقرار بتلف عهدة أو غرامة',
      'Asset Damage or Penalty Acknowledgement',
      'إقرار بتلف عهدة أو غرامة',
      'Asset {{asset_name}} (code {{asset_code}}) issued to {{employee_name}} (Employee ID {{employee_id}}) was reported on {{incident_date}}.',
      'العهدة {{asset_name}} (الرمز {{asset_code}}) المسلّمة إلى {{employee_name}} (رقم الموظف {{employee_id}}) تم الإبلاغ عنها بتاريخ {{incident_date}}.',
      'I, {{employee_name}}, acknowledge the damage described here and the resulting penalty of KD {{penalty_amount_kwd}}. Description: {{damage_description}}',
      'أقر أنا {{employee_name}} بالتلف الموضح هنا وبالغرامة المترتبة عليه وقدرها {{penalty_amount_kwd}} د.ك. الوصف: {{damage_description}}'
    ),
    (
      'traffic',
      'Traffic Violation Acknowledgement',
      'إقرار بمخالفة مرورية',
      'Traffic Violation Acknowledgement',
      'إقرار بمخالفة مرورية',
      'Violation {{violation_reference}} — {{violation_type}} on {{violation_date}}, vehicle {{vehicle_plate}}. Recorded against {{employee_name}} (Employee ID {{employee_id}}).',
      'المخالفة {{violation_reference}} — {{violation_type}} بتاريخ {{violation_date}}، المركبة {{vehicle_plate}}. مسجلة على {{employee_name}} (رقم الموظف {{employee_id}}).',
      'I, {{employee_name}}, acknowledge this traffic violation and the fine of KD {{fine_amount_kwd}}, and confirm that I am responsible for paying it.',
      'أقر أنا {{employee_name}} بهذه المخالفة المرورية وبغرامتها البالغة {{fine_amount_kwd}} د.ك، وأتحمل مسؤولية سدادها.'
    ),
    (
      'unexcused_absence',
      'Unexcused Absence Penalty Notice',
      'إشعار غرامة غياب بدون عذر',
      'Unexcused Absence Penalty Notice',
      'إشعار غرامة غياب بدون عذر',
      '{{employee_name}} (Employee ID {{employee_id}}) was absent without an approved excuse on {{absence_date}} for {{absence_days}} day(s).',
      'تغيّب {{employee_name}} (رقم الموظف {{employee_id}}) بدون عذر معتمد بتاريخ {{absence_date}} لمدة {{absence_days}} يوم.',
      'I, {{employee_name}}, acknowledge the unexcused absence above and the penalty of KD {{penalty_amount_kwd}}. {{penalty_note}}',
      'أقر أنا {{employee_name}} بالغياب بدون عذر المذكور أعلاه وبالغرامة البالغة {{penalty_amount_kwd}} د.ك. {{penalty_note}}'
    ),
    (
      'other',
      'General Acknowledgement',
      'إقرار عام',
      'General Acknowledgement',
      'إقرار عام',
      'This document is issued to {{employee_name}} (Employee ID {{employee_id}}, Driver ID {{driver_code}}). Subject: {{subject}}. Details: {{details}}',
      'يُصدر هذا المستند إلى {{employee_name}} (رقم الموظف {{employee_id}}، رقم السائق {{driver_code}}). الموضوع: {{subject}}. التفاصيل: {{details}}',
      'I, {{employee_name}}, confirm that I have read and understood the content of this document.',
      'أقر أنا {{employee_name}} بأنني قرأت وفهمت محتوى هذا المستند.'
    ),
    (
      'loan_agreement',
      'Loan Agreement and Repayment Terms',
      'اتفاقية سلفة وشروط السداد',
      'Loan Agreement and Repayment Terms',
      'اتفاقية سلفة وشروط السداد',
      '{{company_name}} grants {{employee_name}} (Employee ID {{employee_id}}) a loan of KD {{loan_amount_kwd}}, repaid as {{installment_count}} monthly instalments of KD {{installment_amount_kwd}} starting {{first_installment_date}}.',
      'تمنح {{company_name}} الموظف {{employee_name}} (رقم الموظف {{employee_id}}) سلفة بمبلغ {{loan_amount_kwd}} د.ك، تُسدد على {{installment_count}} قسط شهري بقيمة {{installment_amount_kwd}} د.ك ابتداءً من {{first_installment_date}}.',
      'I, {{employee_name}}, acknowledge the loan amount and the repayment schedule above, and authorise the monthly deduction from my salary until it is settled in full.',
      'أقر أنا {{employee_name}} بمبلغ السلفة وجدول السداد المذكورين أعلاه، وأوافق على الخصم الشهري من راتبي حتى سدادها بالكامل.'
    ),
    (
      'asset_handover',
      'Asset Handover Acknowledgement',
      'إقرار استلام عهدة',
      'Asset Handover Acknowledgement',
      'إقرار استلام عهدة',
      '{{employee_name}} (Employee ID {{employee_id}}, Driver ID {{driver_code}}) received the asset {{asset_name}} (code {{asset_code}}) on {{handover_date}} in the condition stated below.',
      'استلم {{employee_name}} (رقم الموظف {{employee_id}}، رقم السائق {{driver_code}}) العهدة {{asset_name}} (الرمز {{asset_code}}) بتاريخ {{handover_date}} بالحالة الموضحة أدناه.',
      'I, {{employee_name}}, acknowledge receiving this asset in the stated condition ({{asset_condition}}). If it is lost or damaged through my negligence I will pay KD {{replacement_value_kwd}} or its repair cost.',
      'أقر أنا {{employee_name}} باستلام هذه العهدة بالحالة المذكورة ({{asset_condition}}). وفي حال فقدانها أو تلفها بسبب إهمالي ألتزم بدفع {{replacement_value_kwd}} د.ك أو تكلفة إصلاحها.'
    )
)
INSERT INTO public.esign_templates (
  category_key, name_en, name_ar, header_en, header_ar, body_en, body_ar,
  declaration_en, declaration_ar, default_language, is_active
)
SELECT
  s.category_key, s.name_en, s.name_ar, s.header_en, s.header_ar, s.body_en, s.body_ar,
  s.declaration_en, s.declaration_ar, 'en', true
FROM seed s
WHERE EXISTS (
  SELECT 1 FROM public.esign_categories c WHERE c.key = s.category_key
)
AND NOT EXISTS (
  SELECT 1 FROM public.esign_templates t
  WHERE t.category_key = s.category_key AND t.name_en = s.name_en
);

WITH seed (category_key, template_name, field_key, label_en, label_ar, field_type, is_required, sort_order) AS (
  VALUES
    ('accommodation', 'Accommodation Deduction Acknowledgement', 'property_name', 'Property name', 'اسم السكن', 'text', true, 10),
    ('accommodation', 'Accommodation Deduction Acknowledgement', 'property_address', 'Property address', 'عنوان السكن', 'text', false, 20),
    ('accommodation', 'Accommodation Deduction Acknowledgement', 'monthly_rent_kwd', 'Monthly rent (KD)', 'الإيجار الشهري (د.ك)', 'number', true, 30),
    ('accommodation', 'Accommodation Deduction Acknowledgement', 'deduction_amount_kwd', 'Monthly deduction (KD)', 'الخصم الشهري (د.ك)', 'number', true, 40),
    ('accommodation', 'Accommodation Deduction Acknowledgement', 'effective_month', 'Effective month', 'شهر السريان', 'text', true, 50),

    ('salary_slips', 'Salary Deduction Acknowledgement', 'slip_month', 'Salary month', 'شهر الراتب', 'text', true, 10),
    ('salary_slips', 'Salary Deduction Acknowledgement', 'gross_salary_kwd', 'Gross salary (KD)', 'الراتب الإجمالي (د.ك)', 'number', true, 20),
    ('salary_slips', 'Salary Deduction Acknowledgement', 'deduction_amount_kwd', 'Deduction (KD)', 'الخصم (د.ك)', 'number', true, 30),
    ('salary_slips', 'Salary Deduction Acknowledgement', 'net_salary_kwd', 'Net salary (KD)', 'صافي الراتب (د.ك)', 'number', false, 40),
    ('salary_slips', 'Salary Deduction Acknowledgement', 'deduction_reason', 'Deduction reason', 'سبب الخصم', 'textarea', true, 50),

    ('administrative', 'Administrative Memo Acknowledgement', 'memo_reference', 'Memo reference', 'رقم التعميم', 'text', true, 10),
    ('administrative', 'Administrative Memo Acknowledgement', 'memo_subject', 'Subject', 'الموضوع', 'text', true, 20),
    ('administrative', 'Administrative Memo Acknowledgement', 'issue_date', 'Issue date', 'تاريخ الإصدار', 'text', true, 30),
    ('administrative', 'Administrative Memo Acknowledgement', 'memo_body', 'Memo content', 'نص التعميم', 'textarea', true, 40),

    ('asset_docs', 'Asset Damage or Penalty Acknowledgement', 'asset_name', 'Asset name', 'اسم العهدة', 'text', true, 10),
    ('asset_docs', 'Asset Damage or Penalty Acknowledgement', 'asset_code', 'Asset code', 'رمز العهدة', 'text', false, 20),
    ('asset_docs', 'Asset Damage or Penalty Acknowledgement', 'incident_date', 'Incident date', 'تاريخ الحادث', 'text', true, 30),
    ('asset_docs', 'Asset Damage or Penalty Acknowledgement', 'damage_description', 'Damage description', 'وصف التلف', 'textarea', true, 40),
    ('asset_docs', 'Asset Damage or Penalty Acknowledgement', 'penalty_amount_kwd', 'Penalty (KD)', 'الغرامة (د.ك)', 'number', false, 50),

    ('traffic', 'Traffic Violation Acknowledgement', 'violation_reference', 'Violation reference', 'رقم المخالفة', 'text', true, 10),
    ('traffic', 'Traffic Violation Acknowledgement', 'violation_date', 'Violation date', 'تاريخ المخالفة', 'text', true, 20),
    ('traffic', 'Traffic Violation Acknowledgement', 'violation_type', 'Violation type', 'نوع المخالفة', 'text', true, 30),
    ('traffic', 'Traffic Violation Acknowledgement', 'vehicle_plate', 'Vehicle plate', 'لوحة المركبة', 'text', false, 40),
    ('traffic', 'Traffic Violation Acknowledgement', 'fine_amount_kwd', 'Fine (KD)', 'الغرامة (د.ك)', 'number', true, 50),

    ('unexcused_absence', 'Unexcused Absence Penalty Notice', 'absence_date', 'Absence date', 'تاريخ الغياب', 'text', true, 10),
    ('unexcused_absence', 'Unexcused Absence Penalty Notice', 'absence_days', 'Absence days', 'عدد أيام الغياب', 'number', true, 20),
    ('unexcused_absence', 'Unexcused Absence Penalty Notice', 'penalty_amount_kwd', 'Penalty (KD)', 'الغرامة (د.ك)', 'number', false, 30),
    ('unexcused_absence', 'Unexcused Absence Penalty Notice', 'penalty_note', 'Penalty note', 'ملاحظة الغرامة', 'textarea', false, 40),

    ('other', 'General Acknowledgement', 'subject', 'Subject', 'الموضوع', 'text', true, 10),
    ('other', 'General Acknowledgement', 'details', 'Details', 'التفاصيل', 'textarea', true, 20),

    ('loan_agreement', 'Loan Agreement and Repayment Terms', 'loan_amount_kwd', 'Loan amount (KD)', 'مبلغ السلفة (د.ك)', 'number', true, 10),
    ('loan_agreement', 'Loan Agreement and Repayment Terms', 'installment_amount_kwd', 'Instalment (KD)', 'قيمة القسط (د.ك)', 'number', true, 20),
    ('loan_agreement', 'Loan Agreement and Repayment Terms', 'installment_count', 'Number of instalments', 'عدد الأقساط', 'number', true, 30),
    ('loan_agreement', 'Loan Agreement and Repayment Terms', 'first_installment_date', 'First instalment date', 'تاريخ أول قسط', 'text', true, 40),

    ('asset_handover', 'Asset Handover Acknowledgement', 'asset_name', 'Asset name', 'اسم العهدة', 'text', true, 10),
    ('asset_handover', 'Asset Handover Acknowledgement', 'asset_code', 'Asset code', 'رمز العهدة', 'text', false, 20),
    ('asset_handover', 'Asset Handover Acknowledgement', 'handover_date', 'Handover date', 'تاريخ التسليم', 'text', true, 30),
    ('asset_handover', 'Asset Handover Acknowledgement', 'asset_condition', 'Condition', 'الحالة', 'text', true, 40),
    ('asset_handover', 'Asset Handover Acknowledgement', 'replacement_value_kwd', 'Replacement value (KD)', 'قيمة الاستبدال (د.ك)', 'number', false, 50)
)
INSERT INTO public.esign_template_fields (
  template_id, field_key, label_en, label_ar, field_type, options, is_required, sort_order
)
SELECT
  t.id, s.field_key, s.label_en, s.label_ar, s.field_type, '[]'::jsonb, s.is_required, s.sort_order
FROM seed s
JOIN public.esign_templates t
  ON t.category_key = s.category_key AND t.name_en = s.template_name
WHERE NOT EXISTS (
  SELECT 1 FROM public.esign_template_fields f
  WHERE f.template_id = t.id AND f.field_key = s.field_key
)
ON CONFLICT (template_id, field_key) DO NOTHING;
