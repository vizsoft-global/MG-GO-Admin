-- EmployeeDesk V2 — the payslip rows the reference prints, named the way it names them.
--
-- **Why a second file.** `20261115000300` gave `Salary Deduction Acknowledgement`
-- the reference's period / days / money rows, but read against panel C2 the set
-- is short one row and two labels do not match. C2 prints an `Amount` line
-- (`26 days`) under `Rate (KD)`, and it calls the deduction row `Administration
-- deduction (KD)` where the seed says `Deduction (KD)`. Both were checked against
-- the panel rather than assumed, and both are content, not styling: the label is
-- the column heading on a sheet an operator fills in, so a row that says
-- `Deduction` beside a reference that says `Administration deduction` is the
-- disagreement this pass exists to remove.
--
-- **`Amount` is not an invented field.** The seed's own rule (stated in
-- `20261115000300`) is that a row is added only when something real can be put in
-- it. `Amount` is a value the operator enters or the sheet supplies — the same
-- standing as `Rate (KD)` beside it, which the seed did add — so it is a row with
-- a live write path, not a blank line printed on a signed document. The rows the
-- seed deliberately withheld (`Position`, `Employee's Sponsor`, `Pay through` /
-- `Bank number`, `Unsettled Loans if any`) stay withheld: `information_schema`
-- for `drivers` has no job-title, sponsor, bank or loan-balance column, so those
-- can only ever be empty and are still a documentation gap, not a build one.
--
-- **Reading order.** Renumbered to the order the payslip panel reads in: the
-- month, its period, what it was computed on, the days, then the money, then the
-- reason. `sort_order` is display only — it decides the builder list, the preview
-- order and the example sheet's column order, and nothing in the payout or render
-- path keys on it.
--
-- Idempotent by (template `name_en`, `field_key`), matching `20261115000300`.

-- ---------------------------------------------------------------------------
-- 1. The row C2 prints that the seed did not carry
-- ---------------------------------------------------------------------------

INSERT INTO public.esign_template_fields (
  template_id, field_key, label_en, label_ar, field_type,
  source_kind, section_key, is_required, sort_order, options
)
SELECT t.id, 'amount', 'Amount', 'المبلغ', 'text', 'entry', 'document', false, 100, '[]'::jsonb
  FROM public.esign_templates t
 WHERE t.name_en = 'Salary Deduction Acknowledgement'
ON CONFLICT (template_id, field_key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  label_ar = EXCLUDED.label_ar,
  field_type = EXCLUDED.field_type,
  source_kind = EXCLUDED.source_kind,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. The two labels, and the order
-- ---------------------------------------------------------------------------

UPDATE public.esign_template_fields f
   SET label_en = 'Administration deduction (KD)',
       label_ar = 'خصم الإدارة (د.ك)',
       sort_order = 80,
       updated_at = now()
  FROM public.esign_templates t
 WHERE t.id = f.template_id
   AND t.name_en = 'Salary Deduction Acknowledgement'
   AND f.field_key = 'deduction_amount_kwd'
   AND (f.label_en IS DISTINCT FROM 'Administration deduction (KD)' OR f.sort_order <> 80);

UPDATE public.esign_template_fields f
   SET sort_order = v.sort_order,
       updated_at = now()
  FROM public.esign_templates t,
       (VALUES
         ('slip_month', 10),
         ('period_from', 20),
         ('period_to', 30),
         ('computed_on', 40),
         ('fixed_working_days', 50),
         ('actual_working_days', 60),
         ('gross_salary_kwd', 70),
         ('basic_salary_kwd', 90),
         ('extra_input_kwd', 110),
         ('net_salary_kwd', 120),
         ('rate_kwd', 130),
         ('deduction_reason', 140),
         ('employee_signature', 150)
       ) AS v(field_key, sort_order)
 WHERE t.id = f.template_id
   AND t.name_en = 'Salary Deduction Acknowledgement'
   AND f.field_key = v.field_key
   AND f.sort_order <> v.sort_order;
