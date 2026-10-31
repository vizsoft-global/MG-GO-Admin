import type { FrameStatus } from "@/components/app/status-badge";

const FILL: Record<FrameStatus, string> = {
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

export function StatusMixBar({ segments }: { segments: ReadonlyArray<{ key: string; value: number; tone: FrameStatus }> }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) {
    return <div className="h-2 rounded-[var(--radius-bar)] bg-[var(--surface-subtle)]" />;
  }
  return (
    <div className="flex h-2 overflow-hidden rounded-[var(--radius-bar)]">
      {segments.map((segment) => (
        <span key={segment.key} className={FILL[segment.tone]} style={{ width: `${(segment.value / total) * 100}%` }} />
      ))}
    </div>
  );
}
