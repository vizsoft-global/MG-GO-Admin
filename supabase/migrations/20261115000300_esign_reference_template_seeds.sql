-- EmployeeDesk V2 — the seeded template library is given the reference's shape.
--
-- **Why this file exists.** The V2 builder, the live A4 preview and the bulk
-- import all read `document_kind` and `esign_template_fields`, and the ten
-- templates seeded on 2026-11-14 carry almost none of either. Every one of them
-- is `general`, and the library's flagship row — `Loan Request`, the template
-- the reference draws in panel B2 — has **zero** fields. So an author opening
-- the builder today sees a dashed "no fields yet" placeholder where the
-- reference prints Purpose of loan / Requested Amount / Payment Method / Date,
-- no template anywhere produces the `Penalty Details` table, no template
-- produces the loan clause, and two of the four source badges — `Fixed` and
-- `Signed by a person` — have no row in the whole library that exercises them.
-- The code for all of it shipped; the data did not, which is why the screens
-- look emptier than the design without anything being visibly broken.
--
-- **What this is not.** No new column, no new kind, no invented field. Every row
-- below is a row the reference prints, and `document_kind` is set to one of the
-- three values the existing CHECK already allows. Where the reference lists a
-- system-filled row this schema has **no column** for — `Position`,
-- `Employee's Sponsor`, `Pay through` / `Bank number`, `Unsettled Loans if any`
-- — it is deliberately not added. Those are not existing facts being surfaced;
-- they are fields with nothing behind them, and a row that can only ever be
-- empty prints a blank line on a document a person signs. That is the same rule
-- `20261115000200` used when it added civil ID / joining date / accommodation:
-- those three are `drivers` columns that already existed.
--
-- **The kind change is preview-only, and that is measured rather than assumed.**
-- `src/features/esign/render/esign-document-html.ts` does not mention
-- `document_kind` at all — search it — and renders whatever field values the
-- request stored. So a request already sent keeps printing exactly what it
-- printed, and the only thing that changes is the builder's A4 preview (and any
-- future kind-aware renderer). Nothing is re-rendered, nothing is re-sent, and
-- no stored `esign_requests` row is touched.
--
-- **Idempotent by (template `name_en`, `field_key`).** The library has no unique
-- constraint on the name — `20261114000100` seeded it by name for the same
-- reason — so a re-run updates in place rather than duplicating, and a template
-- an operator has renamed is skipped instead of being re-created beside its
-- renamed self. Existing labels and options on rows this file does not name are
-- left exactly as they were.
--
-- **One limitation recorded rather than worked around:** `options` is a flat
-- `jsonb` string array, so an option list has one language and the builder has
-- no per-option `label_ar`. The Penalty Details list below therefore carries the
-- reference's English literals, and it will read as English in the Arabic UI.
-- Options are data an operator edits in the builder, not schema, so the fix is a
-- bilingual options shape — a change to the builder UI and the DB contract for
-- every select field — and guessing at one here would be inventing a contract to
-- serve a single list.

-- ---------------------------------------------------------------------------
-- 1. Document kind — the reference's three document shapes
-- ---------------------------------------------------------------------------
--
-- `penalty` renders the body as the reference's two-column Item / Value table;
-- `loan` renders it as the details grid plus the "in case of not receiving the
-- loan" ruled blank. Both branches already exist in `document-preview.tsx`; they
-- were simply unreachable, because nothing in the library was ever either kind.
--
-- The assignment follows the document, not the category chip: a salary
-- deduction, a traffic fine and an asset penalty are all notices with a
-- deduction and an amount, which is exactly what the penalty table draws, and
-- the two loan documents are the pair that carry a repayment schedule.

UPDATE public.esign_templates
   SET document_kind = 'penalty',
       version = version + 1,
       updated_at = now()
 WHERE document_kind <> 'penalty'
   AND name_en IN (
     'Unexcused Absence Penalty Notice',
     'Salary Deduction Acknowledgement',
     'Traffic Violation Acknowledgement',
     'Asset Damage or Penalty Acknowledgement'
   );

UPDATE public.esign_templates
   SET document_kind = 'loan',
       version = version + 1,
       updated_at = now()
 WHERE document_kind <> 'loan'
   AND name_en IN (
     'Loan Request',
     'Loan Agreement and Repayment Terms'
   );

-- ---------------------------------------------------------------------------
-- 2. The reference's field rows
-- ---------------------------------------------------------------------------
--
-- Sort orders follow the reference's own reading order within each template.
-- Where a number belongs to a row that already exists, it is moved rather than
-- duplicated, so `Salary Deduction Acknowledgement` prints Month title → period
-- → computed on → working days → the money rows → reason, which is the order the
-- payslip panel reads in. `sort_order` is display only — it decides the builder
-- list, the preview order and the example sheet's column order, and nothing in
-- the payout or render path keys on it.

DO $$
DECLARE
  v_template uuid;
  v_row record;
BEGIN
  FOR v_row IN
    SELECT *
      FROM (VALUES
        -- -- Loan Request — panel B2's right-hand template, seeded with no
        -- -- fields at all. These four are the reference's `You enter` rows,
        -- -- the fixed repayment clause is its `Fixed` row, and the signature
        -- -- is its `Signed by a person` row.
        ('Loan Request', 'purpose_of_loan',       'Purpose of loan',        'الغرض من السلفة',      'text',     'entry',     true,  10, '[]'::jsonb),
        ('Loan Request', 'requested_amount_kwd',  'Requested Amount',       'المبلغ المطلوب',       'number',   'entry',     true,  20, '[]'::jsonb),
        ('Loan Request', 'payment_method',        'Payment Method',         'طريقة الدفع',          'select',   'entry',     true,  30, '["Cash","Salary"]'::jsonb),
        ('Loan Request', 'request_date',          'Date',                   'التاريخ',              'date',     'entry',     true,  40, '[]'::jsonb),
        ('Loan Request', 'repayment_method',      'Repayment method',       'طريقة السداد',         'text',     'fixed',     true,  50, '["Monthly salary deduction"]'::jsonb),
        ('Loan Request', 'employee_signature',    'Employee Signature',     'توقيع الموظف',         'text',     'signature', false, 60, '[]'::jsonb),

        -- -- Loan Agreement — the same two rows the request voucher needs, so
        -- -- the agreement carries the applicant's own purpose and signature
        -- -- rather than only the instalment arithmetic.
        ('Loan Agreement and Repayment Terms', 'purpose_of_loan',    'Purpose of loan',    'الغرض من السلفة', 'text', 'entry',     true,  50, '[]'::jsonb),
        ('Loan Agreement and Repayment Terms', 'employee_signature', 'Employee Signature', 'توقيع الموظف',    'text', 'signature', false, 60, '[]'::jsonb),

        -- -- Unexcused Absence Penalty Notice — the reference's Penalty
        -- -- Notice. The seven options are its literal Penalty Details list.
        ('Unexcused Absence Penalty Notice', 'penalty_details', 'Penalty Details', 'تفاصيل الجزاء', 'select', 'entry',
         true, 50,
         '["10% deduction of a day''s salary","Two days deduction","Three days deduction","Four days deduction","Five days deduction","Dismissal final warning","others"]'::jsonb),
        ('Unexcused Absence Penalty Notice', 'employee_signature', 'Employee Signature', 'توقيع الموظف', 'text', 'signature', false, 60, '[]'::jsonb),

        -- -- The other two penalty notices get the signature row, so the
        -- -- `Signed by a person` badge is not unique to one template.
        ('Traffic Violation Acknowledgement', 'employee_signature', 'Employee Signature', 'توقيع الموظف', 'text', 'signature', false, 60, '[]'::jsonb),
        ('Asset Damage or Penalty Acknowledgement', 'employee_signature', 'Employee Signature', 'توقيع الموظف', 'text', 'signature', false, 60, '[]'::jsonb),

        -- -- Salary Deduction Acknowledgement — the reference's Payslip panel
        -- -- (C2). The period, the working-day counts and the rate are the rows
        -- -- the reference prints that this template did not carry.
        ('Salary Deduction Acknowledgement', 'period_from',         'Period from',                 'من تاريخ',                  'date',   'entry', false, 20, '[]'::jsonb),
        ('Salary Deduction Acknowledgement', 'period_to',           'Period to',                   'إلى تاريخ',                 'date',   'entry', false, 30, '[]'::jsonb),
        ('Salary Deduction Acknowledgement', 'computed_on',         'Computed on',                 'تاريخ الاحتساب',            'date',   'entry', false, 40, '[]'::jsonb),
        ('Salary Deduction Acknowledgement', 'fixed_working_days',  'Fixed Monthly Working Days',  'أيام العمل الشهرية الثابتة', 'number', 'entry', false, 50, '[]'::jsonb),
        ('Salary Deduction Acknowledgement', 'actual_working_days', 'Actual Working Days',         'أيام العمل الفعلية',         'number', 'entry', false, 60, '[]'::jsonb),
        ('Salary Deduction Acknowledgement', 'basic_salary_kwd',    'Basic salary (KD)',           'الراتب الأساسي (د.ك)',       'number', 'entry', false, 70, '[]'::jsonb),
        ('Salary Deduction Acknowledgement', 'extra_input_kwd',     'Extra input (KD)',            'مدخل إضافي (د.ك)',          'number', 'entry', false, 80, '[]'::jsonb),
        ('Salary Deduction Acknowledgement', 'rate_kwd',            'Rate (KD)',                   'المعدل (د.ك)',              'number', 'entry', false, 90, '[]'::jsonb),
        ('Salary Deduction Acknowledgement', 'employee_signature',  'Employee Signature',          'توقيع الموظف',              'text',   'signature', false, 100, '[]'::jsonb)
      ) AS v(template_name, field_key, label_en, label_ar, field_type, source_kind, is_required, sort_order, options)
  LOOP
    SELECT id INTO v_template
      FROM public.esign_templates
     WHERE name_en = v_row.template_name;

    -- A renamed or deleted template is skipped, not re-created.
    CONTINUE WHEN v_template IS NULL;

    INSERT INTO public.esign_template_fields (
      template_id, field_key, label_en, label_ar, field_type,
      source_kind, section_key, is_required, sort_order, options
    ) VALUES (
      v_template, v_row.field_key, v_row.label_en, v_row.label_ar, v_row.field_type,
      v_row.source_kind, 'document', v_row.is_required, v_row.sort_order, v_row.options
    )
    ON CONFLICT (template_id, field_key) DO UPDATE SET
      label_en = EXCLUDED.label_en,
      label_ar = EXCLUDED.label_ar,
      field_type = EXCLUDED.field_type,
      source_kind = EXCLUDED.source_kind,
      is_required = EXCLUDED.is_required,
      sort_order = EXCLUDED.sort_order,
      options = EXCLUDED.options,
      updated_at = now();
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Reading order on the rows that already existed
-- ---------------------------------------------------------------------------
--
-- Two renames and a renumber, no new row. `slip_month` keeps its key so nothing
-- that already writes it moves, and only the label an author reads changes to
-- the reference's "Month title". The renumber interleaves the rows added above
-- into the reference's sequence: a salary month, its period, what it was
-- computed on, the days, the money, then the reason.

UPDATE public.esign_template_fields f
   SET label_en = 'Month title',
       label_ar = 'عنوان الشهر',
       sort_order = 10,
       updated_at = now()
  FROM public.esign_templates t
 WHERE t.id = f.template_id
   AND t.name_en = 'Salary Deduction Acknowledgement'
   AND f.field_key = 'slip_month';

UPDATE public.esign_template_fields f
   SET sort_order = v.sort_order,
       updated_at = now()
  FROM public.esign_templates t,
       (VALUES
         ('gross_salary_kwd', 110),
         ('deduction_amount_kwd', 120),
         ('net_salary_kwd', 130),
         ('deduction_reason', 140)
       ) AS v(field_key, sort_order)
 WHERE t.id = f.template_id
   AND t.name_en = 'Salary Deduction Acknowledgement'
   AND f.field_key = v.field_key
   AND f.sort_order <> v.sort_order;
