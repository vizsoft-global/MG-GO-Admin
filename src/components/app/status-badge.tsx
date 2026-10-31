import { cn } from "@/lib/utils";

export type FrameStatus =
  | "working"
  | "leave"
  | "sick"
  | "pending"
  | "absent"
  | "overdue"
  | "neutral"
  | "accident"
  | "other";

const TONE: Record<FrameStatus, string> = {
  working: "bg-[var(--status-working-bg)] text-[var(--status-working-fg)]",
  leave: "bg-[var(--status-leave-bg)] text-[var(--status-leave-fg)]",
  sick: "bg-[var(--status-sick-bg)] text-[var(--status-sick-fg)]",
  pending: "bg-[var(--status-sick-bg)] text-[var(--status-sick-fg)]",
  absent: "bg-[var(--status-absent-bg)] text-[var(--status-absent-fg)]",
  overdue: "bg-[var(--status-absent-bg)] text-[var(--status-absent-fg)]",
  neutral: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
  accident: "bg-[var(--status-accident-bg)] text-[var(--status-accident-fg)]",
  other: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
};

export function StatusBadge({ status, label, className }: { status: FrameStatus; label: string; className?: string }) {
  switch (status) {
    case "working":
    case "leave":
    case "sick":
    case "pending":
    case "absent":
    case "overdue":
    case "neutral":
    case "accident":
    case "other":
      return (
        <span className={cn("inline-flex h-6 items-center rounded-[var(--radius-pill)] px-2 text-xs font-medium", TONE[status], className)}>
          {label}
        </span>
      );
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}
