export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function escapeCsvCell(v: string | number | boolean | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(
  header: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const lines = [
    header.join(","),
    ...rows.map((r) => r.map(escapeCsvCell).join(",")),
  ];
  return "\uFEFF" + lines.join("\n");
}
