/**
 * What goes *into* a batch archive, and under what name.
 *
 * Split out from the route that streams the bytes because the naming rules are
 * the part with judgement in them, and because they are the part that can be
 * wrong in a way nobody notices until an operator opens the archive. A route
 * that both decided names and buffered documents would need a Supabase client
 * to be tested at all; this file needs an array.
 *
 * **Filenames are for a human at a desk, not a machine.** The operator
 * downloads "every signed document in BAT-0041" to file them, forward them, or
 * send one back to a rider who lost it — so the name that helps is the one
 * naming *who*. Employee ID is the fleet's primary key for a rider, so it leads;
 * the request code follows because it is what the panel's own screens print and
 * what a support conversation quotes. The storage key is the last resort, and
 * only because a document with no rider still has to have a name.
 */

/** Characters no filesystem on a desktop will accept. */
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME = /[\u0000-\u001f<>:"/\\|?*]/g;

export function sanitizeArchiveSegment(raw: string): string {
  return raw
    .replace(UNSAFE_FILENAME, " ")
    // Collapse whitespace so a value like "Ali   Hassan" does not leave a
    // three-space run that makes two adjacent names look misaligned in a list.
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot hides the file on Unix and is never intended here.
    .replace(/^\.+/, "")
    .slice(0, 80);
}

/**
 * ASCII-safe fallback for a name that sanitised down to nothing.
 *
 * Arabic names are entirely legal in ZIP (`FLAG_UTF8` is set) and are kept
 * verbatim. This exists for the genuinely empty case — a missing name, or one
 * that was only punctuation — where the alternative is a file called `-.pdf`.
 */
export function archiveNameFallback(rowIndex: number): string {
  return `row-${rowIndex + 1}`;
}

export function archiveExtension(storageKey: string): string {
  const last = storageKey.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) return "pdf";
  const ext = last.slice(dot + 1).toLowerCase();
  // Only extensions we actually store, so a `.exe` on a key that arrived from
  // somewhere unexpected cannot become a `.exe` in the operator's downloads
  // folder. Anything else is treated as a PDF, which is the only document kind
  // in practice.
  return ext === "png" ? "png" : ext === "jpg" || ext === "jpeg" ? "jpg" : "pdf";
}

export type EsignZipRowInput = {
  row_index: number;
  employee_id: string | null;
  request_code: string | null;
  /** The rider's display name, when the join resolved one. */
  driver_name?: string | null;
  /** `signed_document_storage_key` — the archived copy, never the source. */
  signed_key: string | null;
};

export type EsignZipEntryPlan = {
  /** Path inside the archive. */
  name: string;
  storage_key: string;
};

/**
 * The name for one row.
 *
 * Order is `Employee ID — Request code — Rider name`, which puts the two
 * identifiers first so a sorted list groups a rider's documents together and
 * keeps the human name last where a long one can be truncated without losing
 * anything an operator searches on.
 */
export function esignArchiveName(row: EsignZipRowInput, extension: string): string {
  const parts: string[] = [];
  const employeeId = sanitizeArchiveSegment(row.employee_id ?? "");
  if (employeeId) parts.push(employeeId);
  const code = sanitizeArchiveSegment(row.request_code ?? "");
  if (code) parts.push(code);
  const name = sanitizeArchiveSegment(row.driver_name ?? "");
  if (name) parts.push(name);
  const stem = parts.length > 0 ? parts.join(" - ") : archiveNameFallback(row.row_index);
  return `${stem}.${extension}`;
}

/**
 * Fold rows into the archive's file list.
 *
 * Two filters, both of which matter more than they look. A row with no
 * `signed_key` has nothing to archive — an unsigned or failed row would
 * otherwise contribute a zero-byte file that reads as a corrupt document. And
 * names collide legitimately: two rows can share an employee ID and a request
 * code is per-row, but a manual repair can point two rows at the same rider, so
 * a `-2` suffix is applied on repeat rather than letting the archive silently
 * keep the last one.
 */
export function planEsignZipEntries(rows: EsignZipRowInput[]): EsignZipEntryPlan[] {
  const used = new Map<string, number>();
  const plan: EsignZipEntryPlan[] = [];
  for (const row of rows) {
    const key = row.signed_key?.trim();
    if (!key) continue;
    const extension = archiveExtension(key);
    const base = esignArchiveName(row, extension);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    // Rebuilt from the stem rather than by slicing the extension off `base`,
    // because `.pdf` / `.jpg` are both four characters today and the slice
    // would quietly corrupt the name the first time that stops being true.
    const stem = base.slice(0, base.length - extension.length - 1);
    const name = seen === 0 ? base : `${stem} (${seen + 1}).${extension}`;
    plan.push({ name, storage_key: key });
  }
  return plan;
}

/** `BAT-0041-signed.zip`, and never an empty stem. */
export function esignArchiveFilename(batchCode: string | null, title: string | null): string {
  const stem = sanitizeArchiveSegment(batchCode ?? "") || sanitizeArchiveSegment(title ?? "") || "esign";
  return `${stem}-signed.zip`;
}
