export const IMPORT_CHUNK_APPROVE = 5;
export const IMPORT_CHUNK_SAVE = 15;

export type DriverImportLogKind =
  | "created"
  | "updated"
  | "approved"
  | "skipped"
  | "failed";

export type DriverImportLogEvent = {
  at: string;
  kind: DriverImportLogKind;
  rowIndex: number;
  name: string;
  employeeId?: string;
  zone?: string;
  driverCode?: string;
  detail?: string;
};

const MARK: Record<DriverImportLogKind, string> = {
  created: "+",
  updated: "~",
  approved: "+",
  skipped: "-",
  failed: "!",
};

/** Small enough that one serverless turn cannot hang on a hundred approves. */
export function importChunkSize(
  rows: readonly { active: boolean | null }[],
  approveImmediately: boolean,
): number {
  const willApprove = rows.some((row) => row.active ?? approveImmediately);
  return willApprove ? IMPORT_CHUNK_APPROVE : IMPORT_CHUNK_SAVE;
}

export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

export function formatImportClock(iso: string): string {
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return "--:--:--";
  return stamp.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * One line, Linux-journal style: mark, verb, who, then the facts that matter.
 * Passcode is never written — credentials stay on the download sheet.
 */
export function formatImportLogLine(event: DriverImportLogEvent): string {
  const who = event.name.trim() || `row ${event.rowIndex + 1}`;
  const bits = [
    `[${formatImportClock(event.at)}]`,
    MARK[event.kind],
    event.kind.padEnd(8),
    who,
  ];
  if (event.employeeId) bits.push(`emp=${event.employeeId}`);
  if (event.zone) bits.push(`zone=${event.zone}`);
  if (event.driverCode) bits.push(`code=${event.driverCode}`);
  if (event.detail) bits.push(event.detail);
  return bits.join("  ");
}

export function importProgressLabel(done: number, total: number): string {
  return `${done}/${total}`;
}
