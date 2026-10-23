function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Downloads a CSV in the browser. Headers are the contract; callers pass plain cells only. */
export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly string[])[]) {
  const lines = [headers, ...rows].map((cols) => cols.map((cell) => escapeCell(cell)).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
