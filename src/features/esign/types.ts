import type { EsignRecipientStage } from "./esign-recipient-stage";

/** Mirrors the `esign_request_status` enum. `declined` renders as "Rejected" in Figma. */
export type EsignRequestStatus =
  | "pending"
  | "signed"
  | "expired"
  | "cancelled"
  | "declined";

/**
 * Field provenance, mirroring the `source_kind` CHECK on
 * `esign_template_fields`. These four are the source badges the reference
 * template builder puts on every field row.
 */
export const ESIGN_FIELD_SOURCES = [
  "system",
  "entry",
  "fixed",
  "signature",
] as const;
export type EsignFieldSource = (typeof ESIGN_FIELD_SOURCES)[number];

/** Which block of the A4 preview the field renders in. */
export const ESIGN_FIELD_SECTIONS = ["employee", "document"] as const;
export type EsignFieldSection = (typeof ESIGN_FIELD_SECTIONS)[number];

/**
 * Chooses the preview skeleton.
 *
 * `payslip` is a fourth skeleton rather than a `penalty`, because the reference
 * draws a payroll voucher and a penalty table as two different documents even
 * though both end in a deduction: a penalty notice states *an offence and its
 * consequence*, while a payslip states *a month's arithmetic* — a period, a
 * computed-on date, working days, a rate, and four money rows that a reader
 * checks against each other. Rendering the payslip as an Item / Value penalty
 * table folded all of that into one column and lost the arithmetic, which is
 * the only thing the sheet is for. The renderer itself stays kind-agnostic (it
 * prints whatever field values the request stored), so this changes the
 * builder's preview and any future kind-aware renderer — never a sent document.
 */
export const ESIGN_DOCUMENT_KINDS = ["penalty", "loan", "payslip", "general"] as const;
export type EsignDocumentKind = (typeof ESIGN_DOCUMENT_KINDS)[number];

export type EsignStatusCounts = {
  all: number;
  pending: number;
  signed: number;
  declined: number;
  expired: number;
  cancelled: number;
  /**
   * The two halves of `pending`, split by whether the rider has opened the
   * document. They are *recipient stages*, not statuses — see
   * `EsignRecipientStageQuery` — so an overdue pending row is in neither and is
   * counted under `expired` instead.
   */
  opened: number;
  notOpened: number;
  /** Signed within the trailing 30 days — the Figma "Signed (30d)" KPI. */
  signedLast30d: number;
  /** Sent within the trailing 30 days — the Figma "Sent (30d)" KPI. */
  sentLast30d: number;
  categories: number;
};

/**
 * The two derived recipient filters the list RPC accepts beside the enum
 * statuses.
 *
 * `admin_list_esign_requests` reads them as `recipient_stage` rather than
 * `status`, which is the whole point: "not opened" is not a state of the
 * document, it is a state of the rider, and the enum has no member for it. They
 * live on their own type so `EsignListFilters.status` can accept exactly these
 * two additions without widening `EsignRequestStatus` — a wider enum would let
 * `status: "opened"` reach `effectiveEsignStatus`, which would then hand it
 * straight back and put a value in the status column that the enum says cannot
 * exist.
 */
export type EsignRecipientStageQuery = "opened" | "not_opened";

export type EsignListFilters = {
  status?: EsignRequestStatus | EsignRecipientStageQuery | null;
  limit?: number;
  offset?: number;
  template_id?: string | null;
  batch_id?: string | null;
};

export type EsignListRow = {
  id: string;
  request_code: string;
  title: string;
  category_key: string | null;
  category_label: string | null;
  driver_id: string;
  driver_name: string;
  driver_code: string;
  status: EsignRequestStatus;
  due_at: string | null;
  screenshot_restricted: boolean;
  /** Equal to `created_at` today — the only inserter sends on insert. */
  sent_at: string;
  /** First time the rider opened the document. */
  viewed_at: string | null;
  declined_at: string | null;
  signed_at: string | null;
  signer_display_name: string | null;
  created_at: string;
  template_id?: string | null;
  template_name?: string | null;
  batch_id?: string | null;
  batch_code?: string | null;
  description?: string | null;
  /**
   * The server's own derivation of the four recipient states, returned by
   * `admin_list_esign_requests` alongside `display_status`.
   *
   * Optional because the V1 detail/CSV readers were built before the column
   * existed and never ask for it — a required field would force every one of
   * them to invent a value. `esignRecipientStage` derives the same answer from
   * `status` + `viewed_at` for the rows that arrive without it, which is the
   * one property that keeps the server and the tracker from disagreeing.
   */
  recipient_stage?: EsignRecipientStage;
  /** The last reminder a sender logged against this row, and how many. */
  last_reminded_at?: string | null;
  reminder_count?: number;
};

/**
 * The minimum a tracker roll-up needs from a recipient.
 *
 * Deliberately not `EsignListRow`: the tracker list draws twenty-five rows of
 * progress bars above recipient names, and shipping each one's title, category,
 * description and screenshot flag would send a screen of text nobody renders.
 * The batch detail page fetches the full rows for one batch instead.
 */
export type EsignTrackerRecipient = {
  id: string;
  batch_id: string;
  /**
   * The `SIG-####` the operator recognises.
   *
   * Carried so the bulk reminder drawer can name each rider by the code the
   * task list shows rather than by a UUID, without a second read: the tracker
   * list already has the row in hand, and a drawer that says "SIG-0142" is one
   * the operator can cross-check against the batch's own table.
   */
  request_code: string;
  /** Already resolved through `effectiveEsignStatus`, so `expired` is a stage. */
  status: string;
  viewed_at: string | null;
};

/** One row of `admin_esign_reminder_state` — the reminder button's own truth. */
export type EsignReminderStateRow = {
  id: string;
  request_code: string;
  status: string;
  viewed_at: string | null;
  last_reminded_at: string | null;
  reminder_count: number;
  /** Whole hours before this recipient may be reminded again; 0 means now. */
  hours_left: number;
};

export type EsignReminderState = {
  cooldownHours: number;
  rows: EsignReminderStateRow[];
};

/** `single` = the send screen, `bulk` = the Excel screen. */
export type EsignDraftKind = "single" | "bulk";

export type EsignDraftRow = {
  id: string;
  kind: EsignDraftKind;
  template_id: string | null;
  template_name: string | null;
  /** The template version the draft was authored against. */
  template_version: number | null;
  language: EsignLocale;
  title: string | null;
  due_at: string | null;
  description: string | null;
  source_filename: string | null;
  /** Bulk drafts only — how many spreadsheet rows are waiting inside. */
  row_count: number;
  created_by_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

/** A draft with its payload, which is what resuming actually needs. */
export type EsignDraftDetail = EsignDraftRow & {
  field_values: Record<string, string>;
  rows: Array<{
    employee_id: string;
    driver_id?: string;
    description?: string;
    field_values?: Record<string, string>;
  }>;
};

export type EsignLocale = "en" | "ar";

export const ESIGN_RESERVED_FIELD_KEYS = [
  "company_name",
  "employee_name",
  "employee_id",
  "driver_code",
  "zone",
  "project",
  "nationality",
] as const;

export type EsignTemplateFieldType = "text" | "textarea" | "number" | "date" | "select";

export type EsignTemplateFieldRow = {
  id: string;
  template_id: string;
  field_key: string;
  label_en: string;
  label_ar: string | null;
  field_type: EsignTemplateFieldType;
  options: string[];
  is_required: boolean;
  sort_order: number;
  /** Where the value comes from — drives the source badge on the field row. */
  source_kind: EsignFieldSource;
  /** Which block of the document the field renders in. */
  section_key: EsignFieldSection;
  /** Optional named dataset an `options` list was copied from. */
  options_source: string | null;
  /**
   * A sample the builder's live preview prints in this row.
   *
   * The reference draws a *filled* payslip, so a preview whose every row is an
   * em-dash cannot be held against it. This is preview-only content — it is
   * never sent, never shown on the rider's form and never rendered into a
   * document — which is why it lives beside `label_en` rather than in the
   * component, where it would be template content in the renderer.
   */
  preview_value: string | null;
};

export type EsignTemplateRow = {
  id: string;
  category_key: string;
  /**
   * The category's own name, resolved from `esign_categories` on the list query.
   *
   * The library card leads with this, and `category_key` is a slug — the
   * reference shows operator-readable words there, so the label is fetched with
   * the row rather than left to the card to look up.
   */
  category_label?: string | null;
  name_en: string;
  name_ar: string | null;
  header_en: string;
  header_ar: string;
  body_en: string;
  body_ar: string;
  declaration_en: string;
  declaration_ar: string;
  default_language: EsignLocale;
  is_active: boolean;
  /** Chooses the preview skeleton (penalty table / loan details / plain body). */
  document_kind: EsignDocumentKind;
  /** A draft is authorable but cannot be sent. */
  is_draft: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  field_count: number;
  /**
   * How many field rows come from each source, so the library card can say
   * where a template's values come from without loading every field.
   *
   * The reference sheet puts a single provenance chip on every card — "FILLED
   * FROM THE SYSTEM" when the system supplies the values, "YOU ENTER" when the
   * author does — and that chip is the fastest way to tell a template that
   * needs an operator per send from one that does not. It is computed on the
   * list query (the field rows are already being counted there, so the extra
   * two columns cost nothing) rather than fetched per card.
   */
  source_counts?: Partial<Record<EsignFieldSource, number>>;
  /**
   * Whether any row is signed off by a person. A template with signature rows
   * renders its own signature slots, which is a different document shape from
   * one that only has the standard employee/HR blocks, so the card says so.
   */
  has_signature_rows?: boolean;
};

export type EsignTemplateDetail = EsignTemplateRow & {
  fields: EsignTemplateFieldRow[];
};

export type EsignResolveStatus =
  | "ok"
  | "unknown_id"
  | "archived"
  | "blocked"
  | "ambiguous"
  | "invalid";

export type EsignResolveRow = {
  row_index: number;
  employee_id: string;
  ok: boolean;
  status: EsignResolveStatus;
  driver_id?: string;
  snapshot?: import("./render/esign-placeholders").EsignEmployeeSnapshot;
};

export type EsignBatchStatus = "queued" | "processing" | "completed" | "partial";
export type EsignBatchRowStatus = "pending" | "created" | "failed";

export type EsignBatchRow = {
  id: string;
  batch_code: string;
  template_id: string;
  template_name: string | null;
  title: string;
  language: EsignLocale;
  status: EsignBatchStatus;
  total_count: number;
  created_count: number;
  failed_count: number;
  due_at: string | null;
  source_filename: string | null;
  created_at: string;
};

export type EsignBatchLine = {
  id: string;
  row_index: number;
  employee_id: string | null;
  driver_id: string | null;
  status: EsignBatchRowStatus;
  error: string | null;
  request_id: string | null;
  request_code: string | null;
  /**
   * The per-row corrections the sheet carried, so the repair dialog opens on
   * what was uploaded rather than on an empty form. Optional because the V1
   * dispatch table never asked for them.
   */
  field_values?: Record<string, string>;
  description?: string | null;
  /**
   * The state the *recipient* reached, which is a different question from the
   * row's dispatch status.
   *
   * `status` says whether this row produced a document; `recipient_stage` says
   * what the rider did with it. The reference's batch detail draws both, and
   * they are genuinely independent — a row can be `created` and `not_opened`
   * for a week. Optional because a row that never produced a document has no
   * recipient to describe.
   */
  recipient_stage?: EsignRecipientStage;
  last_reminded_at?: string | null;
  reminder_count?: number;
  /** Raw `esign_requests.status`, which `esignRecipientStage` consumed. */
  recipient_status?: string | null;
  recipient_viewed_at?: string | null;
  /** The deadline the recipient is running against; `—` when the batch had none. */
  recipient_due_at?: string | null;
  /**
   * Who the document went to, so the row can be read by name.
   *
   * Carried because the repair dialog's whole job is deciding whether the right
   * rider got the right document, and an operator comparing two five-digit
   * employee ids is doing the comparison the screen should have done for them.
   */
  signer_display_name?: string | null;
  /**
   * What the rider wrote when declining, read off `signer_meta`.
   *
   * The column is jsonb and the key is not indexed, so this is extracted at the
   * read rather than queried — the reason is only ever needed for the handful of
   * declined rows on one batch, and a `->>` predicate would need its own index to
   * be worth anything.
   */
  declined_reason?: string | null;
};

export type EsignDetail = EsignListRow & {
  declaration_accepted_at: string | null;
  signer_meta: Record<string, unknown>;
  document_storage_key: string | null;
  signature_storage_key: string | null;
  sent_by: string | null;
  updated_at: string;
};

export type EsignCategoryRow = {
  id: string;
  key: string;
  label_en: string;
  description: string | null;
  icon_key: string | null;
  screenshot_restricted: boolean;
  is_active: boolean;
  sort_order: number;
  /** Signed requests filed under this category — the Figma SIGNED column. */
  signed_count: number;
};

export type EsignDriverOption = {
  id: string;
  full_name: string;
  driver_code: string;
  employee_id: string | null;
};
