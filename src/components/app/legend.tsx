import type { FrameStatus } from "@/components/app/status-badge";
import { cn } from "@/lib/utils";

const SWATCH: Record<FrameStatus, string> = {
  working: "bg-[var(--status-working-fg)]",
  leave: "bg-[var(--status-leave-fg)]",
  sick: "bg-[var(--status-sick-fg)]",
  pending: "bg-[var(--status-sick-fg)]",
  absent: "bg-[var(--status-absent-fg)]",
  overdue: "bg-[var(--status-absent-fg)]",
  neutral: "bg-[var(--status-neutral-fg)]",
  accident: "bg-[var(--status-accident-fg)]",
  other: "bg-[var(--status-neutral-fg)]",
};

export function Legend({ items }: { items: ReadonlyArray<{ label: string; count?: number; tone: FrameStatus }> }) {
  return (
    <ul className="flex flex-wrap gap-x-[var(--gap-section)] gap-y-[var(--gap-tight)]">
      {items.map((item) => (
        <li key={item.label} className="inline-flex h-9 items-center gap-1 text-xs text-[var(--text-secondary)]">
          <span className={cn("size-2.5 rounded-[var(--radius-bar)]", SWATCH[item.tone])} />
          {item.label}
          {item.count != null ? <span className="tabular-nums text-[var(--text-primary)]">{item.count}</span> : null}
        </li>
      ))}
    </ul>
  );
}
