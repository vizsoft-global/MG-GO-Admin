/**
 * The daily upload: Orders for Americana, Working hours for Keeta, Hours for
 * Five Guys — one CSV, one project, one month.
 *
 * Parsing and validation are pure and live here so the dialog, the server action
 * and the tests all read one rule set. The server re-checks every rule against
 * the live roster (a tampered payload must not load another project's rider), so
 * this module is the **first** of two gates, never the only one.
 */
export const UPLOAD_COLUMNS = ["mgId", "date", "value"] as const;

export type UploadColumn = (typeof UPLOAD_COLUMNS)[number];

/** Which projects load hours. Americana loads orders. */
export const HOURS_PROJECTS = ["keeta", "five_guys"] as const;

export type ParsedUploadRow = {
  /** 1-based line in the file, so a rejection names the row the operator sees. */
  line: number;
  mgId: string;
  date: string;
  value: number;
};

export type RejectedUploadRow = {
  line: number;
  code: UploadRejectCode;
  mgId: string | null;
  date: string | null;
  raw: string;
};

export type UploadRejectCode =
  | "row_missing_id"
  | "row_unknown_id"
  | "row_other_project"
  | "row_invalid_date"
  | "row_outside_month"
  | "row_future_date"
  | "row_invalid_value"
  | "row_duplicate";

export type UploadPreview = {
  accepted: ParsedUploadRow[];
  rejected: RejectedUploadRow[];
};

export type UploadRosterEntry = {
  driverId: string;
  /** `drivers.project_key`, lowercase; `""` when the rider has none. */
  projectKey: string;
};

export type UploadContext = {
  /** The project the operator is loading into. */
  projectKey: string;
  /** Kuwait today, `YYYY-MM-DD`. */
  today: string;
  /** Resolve an MG ID (driver code / employee id / client id) to a rider. */
  lookup: (mgId: string) => UploadRosterEntry | null;
  /** True when this project carries hours (cap 24) rather than orders. */
  hours: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `MG ID,Date,Orders` etc. — the header is read, never assumed. */
export function parseUploadCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [] };
  const [head, ...rest] = lines;
  return {
    header: splitCsvLine(head ?? "").map((cell) => cell.trim()),
    rows: rest.map((line) => splitCsvLine(line).map((cell) => cell.trim())),
  };
}

/**
 * A CSV cell may be quoted (a store name with a comma), so the split has to
 * honour quotes rather than cutting on every comma.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

/** Which column holds what, from the header words the template prints. */
export function resolveUploadColumns(header: readonly string[]): Record<UploadColumn, number> {
  const index = (needles: readonly string[]): number =>
    header.findIndex((cell) => {
      const normalised = cell.trim().toLowerCase().replace(/[_]+/g, " ");
      return needles.some((needle) => normalised === needle || normalised.startsWith(needle));
    });
  return {
    mgId: index(["mg id", "mgid", "driver id", "employee id", "driver code"]),
    date: index(["date", "day", "work date"]),
    value: index(["orders", "working hours", "hours", "value"]),
  };
}

/**
 * Parse + validate a file against the selected project.
 *
 * A rejected row never aborts the file: one wrong MG ID must not cost the
 * operator the other 200 rows, and the reason is reported with its line number so
 * the fix is one cell, not a re-export.
 */
export function previewUpload(
  text: string,
  context: UploadContext,
  options: { monthPrefix?: string } = {},
): UploadPreview {
  const { header, rows } = parseUploadCsv(text);
  const columns = resolveUploadColumns(header);
  const monthPrefix = options.monthPrefix ?? `${context.today.slice(0, 7)}-`;
  const accepted: ParsedUploadRow[] = [];
  const rejected: RejectedUploadRow[] = [];
  const seen = new Set<string>();

  rows.forEach((cells, index) => {
    const line = index + 2; // header is line 1
    const raw = cells.join(",");
    if (cells.every((cell) => cell === "")) return;
    const mgId = columns.mgId >= 0 ? (cells[columns.mgId] ?? "").trim() : "";
    const date = columns.date >= 0 ? (cells[columns.date] ?? "").trim() : "";
    const valueText = columns.value >= 0 ? (cells[columns.value] ?? "").trim() : "";

    if (!mgId) {
      rejected.push({ line, code: "row_missing_id", mgId: null, date: date || null, raw });
      return;
    }
    const hit = context.lookup(mgId);
    if (!hit) {
      rejected.push({ line, code: "row_unknown_id", mgId, date: date || null, raw });
      return;
    }
    if (hit.projectKey.trim().toLowerCase() !== context.projectKey.trim().toLowerCase()) {
      rejected.push({ line, code: "row_other_project", mgId, date: date || null, raw });
      return;
    }
    if (!DAY.test(date)) {
      rejected.push({ line, code: "row_invalid_date", mgId, date: date || null, raw });
      return;
    }
    if (!date.startsWith(monthPrefix)) {
      rejected.push({ line, code: "row_outside_month", mgId, date, raw });
      return;
    }
    if (date > context.today) {
      rejected.push({ line, code: "row_future_date", mgId, date, raw });
      return;
    }
    const value = Number(valueText.replace(",", "."));
    if (valueText === "" || !Number.isFinite(value) || value < 0) {
      rejected.push({ line, code: "row_invalid_value", mgId, date, raw });
      return;
    }
    if (context.hours && value > 24) {
      rejected.push({ line, code: "row_invalid_value", mgId, date, raw });
      return;
    }
    // One value per rider per day: a file that lists the same day twice has no
    // single answer, so the second line is refused rather than silently winning.
    const key = `${hit.driverId}|${date}`;
    if (seen.has(key)) {
      rejected.push({ line, code: "row_duplicate", mgId, date, raw });
      return;
    }
    seen.add(key);
    accepted.push({
      line,
      mgId,
      date,
      value: context.hours ? Math.round(value * 100) / 100 : Math.round(value),
    });
  });

  return { accepted, rejected };
}

/** The template's row, so an operator can see the shape before filling it. */
export function uploadTemplateCsv(
  valueHeader: string,
  examples: readonly { mgId: string; date: string }[],
): string {
  const header = ["MG ID", "Date", valueHeader].join(",");
  const rows = examples.map((row) => [row.mgId, row.date, ""].join(","));
  return [header, ...rows].join("\n");
}

/** `3,912 rows · 12 rejected` — the summary the dialog prints after a preview. */
export function uploadSummaryText(preview: UploadPreview): string {
  return `${preview.accepted.length} accepted · ${preview.rejected.length} rejected`;
}
