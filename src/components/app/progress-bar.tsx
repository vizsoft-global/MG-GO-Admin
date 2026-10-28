export function ProgressBar({ value, max = 100 }: { value: number; max?: number }) {
  const width = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <span className="block h-2 overflow-hidden rounded-[var(--radius-bar)] bg-[var(--surface-subtle)]">
      <span className="block h-full rounded-[var(--radius-bar)] bg-[var(--selected-navy)]" style={{ width: `${width}%` }} />
    </span>
  );
}
