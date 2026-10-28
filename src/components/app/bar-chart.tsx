export function BarChart({ items }: { items: ReadonlyArray<{ label: string; value: number; max?: number }> }) {
  const peak = Math.max(1, ...items.map((item) => item.max ?? item.value));
  return (
    <div className="flex flex-col gap-[var(--gap-tight)]">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-[var(--gap-tight)]">
          <span className="truncate text-xs text-[var(--text-secondary)]">{item.label}</span>
          <span className="h-2 overflow-hidden rounded-[var(--radius-bar)] bg-[var(--surface-subtle)]">
            <span
              className="block h-full rounded-[var(--radius-bar)] bg-[var(--selected-navy)]"
              style={{ width: `${Math.min(100, (item.value / peak) * 100)}%` }}
            />
          </span>
          <span className="text-xs tabular-nums text-[var(--text-primary)]">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
