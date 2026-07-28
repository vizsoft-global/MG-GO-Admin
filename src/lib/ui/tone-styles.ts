/** Shared semantic tone styles for KPI cards, metric tiles, and chips. */

export type Tone = "primary" | "success" | "warning" | "danger" | "neutral";

export const NEUTRAL_TILE =
  "border border-border bg-card shadow-[0_1px_2px_rgba(15,15,15,0.04)] transition-shadow duration-150 hover:shadow-[0_4px_12px_rgba(15,15,15,0.06)]";

export const TONE_STYLES: Record<
  Tone,
  {
    accentBar: string;
    iconChip: string;
    softPill: string;
    solidPill: string;
    dot: string;
    signal: string;
  }
> = {
  primary: {
    accentBar: "",
    iconChip: "bg-primary/10 text-primary",
    softPill: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
    solidPill: "bg-primary text-primary-foreground",
    dot: "bg-primary",
    signal: "bg-primary",
  },
  success: {
    accentBar: "",
    iconChip: "bg-success-bg text-success",
    softPill: "bg-success-bg text-success ring-1 ring-inset ring-success/20",
    solidPill: "bg-success text-white",
    dot: "bg-success",
    signal: "bg-success",
  },
  warning: {
    accentBar: "border-l-2 border-l-warning",
    iconChip: "bg-warning-bg text-warning",
    softPill: "bg-warning-bg text-warning ring-1 ring-inset ring-warning/20",
    solidPill: "bg-warning text-foreground",
    dot: "bg-warning",
    signal: "bg-warning",
  },
  danger: {
    accentBar: "border-l-2 border-l-danger",
    iconChip: "bg-danger-bg text-danger",
    softPill: "bg-danger-bg text-danger ring-1 ring-inset ring-danger/20",
    solidPill: "bg-danger text-white",
    dot: "bg-danger",
    signal: "bg-danger",
  },
  neutral: {
    accentBar: "",
    iconChip: "bg-muted text-muted-foreground",
    softPill: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
    solidPill: "bg-muted-foreground text-background",
    dot: "bg-muted-foreground",
    signal: "bg-muted-foreground",
  },
};

/** Map legacy palette tone names to semantic tones during migration. */
export function normalizeTone(tone: string): Tone {
  switch (tone) {
    case "primary":
    case "blue":
    case "indigo":
      return "primary";
    case "success":
    case "emerald":
    case "green":
      return "success";
    case "warning":
    case "amber":
    case "orange":
    case "yellow":
      return "warning";
    case "danger":
    case "rose":
    case "red":
      return "danger";
    default:
      return "neutral";
  }
}

/** Map KpiCard accent names to semantic tones. */
export function accentToTone(accent: string): Tone {
  if (accent === "default") return "neutral";
  return normalizeTone(accent);
}
