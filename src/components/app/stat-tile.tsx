import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  delta,
  className,
}: {
  label: string;
  value: string | number;
  delta?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-card)] px-[var(--pad-kpi-x)] py-[var(--pad-kpi-y)]",
        className,
      )}
    >
      <p className="text-[13px] text-[var(--text-secondary)]">{label}</p>
      <p className="text-[28px] leading-none font-bold tabular-nums text-[var(--text-primary)]">{value}</p>
      {delta ? <p className="mt-1 text-xs text-[var(--text-muted)]">{delta}</p> : null}
    </div>
  );
}
