export const SERVICE_COLOR_VAR = {
  compliance: "--visit-service-compliance",
  compliances: "--visit-service-compliance",
  hr: "--visit-service-hr",
  hr_services: "--visit-service-hr",
  hrservices: "--visit-service-hr",
  legal: "--visit-service-legal",
  operations: "--visit-service-operations",
  exit: "--visit-service-exit",
  exit_process: "--visit-service-exit",
  exitprocess: "--visit-service-exit",
  documents: "--visit-service-documents",
  documents_signatures: "--visit-service-documents",
  documentssignatures: "--visit-service-documents",
  training: "--visit-service-training",
  meeting: "--visit-service-meeting",
  meeting_request: "--visit-service-meeting",
  meetingrequest: "--visit-service-meeting",
  other: "--visit-service-other",
} as const;

type ServiceColorToken = (typeof SERVICE_COLOR_VAR)[keyof typeof SERVICE_COLOR_VAR];

const SERVICE_BG_CLASS: Record<ServiceColorToken, string> = {
  "--visit-service-compliance": "bg-[var(--visit-service-compliance)]",
  "--visit-service-hr": "bg-[var(--visit-service-hr)]",
  "--visit-service-legal": "bg-[var(--visit-service-legal)]",
  "--visit-service-operations": "bg-[var(--visit-service-operations)]",
  "--visit-service-exit": "bg-[var(--visit-service-exit)]",
  "--visit-service-documents": "bg-[var(--visit-service-documents)]",
  "--visit-service-training": "bg-[var(--visit-service-training)]",
  "--visit-service-meeting": "bg-[var(--visit-service-meeting)]",
  "--visit-service-other": "bg-[var(--visit-service-other)]",
};

function normaliseServiceKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function serviceToken(value: string | undefined): ServiceColorToken | undefined {
  if (!value) return undefined;
  if (Object.prototype.hasOwnProperty.call(SERVICE_COLOR_VAR, value)) {
    return SERVICE_COLOR_VAR[value as keyof typeof SERVICE_COLOR_VAR];
  }
  const normalised = normaliseServiceKey(value);
  if (Object.prototype.hasOwnProperty.call(SERVICE_COLOR_VAR, normalised)) {
    return SERVICE_COLOR_VAR[normalised as keyof typeof SERVICE_COLOR_VAR];
  }
  return undefined;
}

export function serviceColorVar(key: string, label?: string): string {
  const token = serviceToken(key) ?? serviceToken(label) ?? "--visit-service-other";
  return SERVICE_BG_CLASS[token];
}

const SERVICE_SHORT_LABEL: Record<string, string> = {
  compliance: "Compl.",
  compliances: "Compl.",
  complianceservices: "Compl.",
  hr: "HR",
  hrservices: "HR",
  humanresources: "HR",
  legal: "Legal",
  operations: "Ops",
  operationsservices: "Ops",
  exit: "Exit",
  exitprocess: "Exit",
  documents: "Docs",
  documentssignatures: "Docs",
  training: "Training",
  meeting: "Meeting",
  meetingrequest: "Meeting",
  other: "Other",
};

/** Week cells are a third of the day grid wide, so a long catalog label would
 *  truncate mid-word. The frames print a fixed short form instead. */
export function shortServiceLabel(key: string, label?: string): string {
  const known = SERVICE_SHORT_LABEL[normaliseServiceKey(key)];
  if (known) return known;
  if (label) {
    const knownLabel = SERVICE_SHORT_LABEL[normaliseServiceKey(label)];
    if (knownLabel) return knownLabel;
    const first = label.trim().split(/\s+/)[0] ?? label;
    return first.length > 9 ? `${first.slice(0, 8)}…` : first;
  }
  return "—";
}

export function loadClass(level: 0 | 1 | 2 | 3 | 4 | 5): string {
  switch (level) {
    case 0:
      return "bg-[var(--visit-load-0)]";
    case 1:
      return "bg-[var(--visit-load-1)]";
    case 2:
      return "bg-[var(--visit-load-2)]";
    case 3:
      return "bg-[var(--visit-load-3)]";
    case 4:
      return "bg-[var(--visit-load-4)]";
    case 5:
      return "bg-[var(--visit-load-5)]";
    default: {
      const neverLevel: never = level;
      return neverLevel;
    }
  }
}

type BookingStatusTone = "confirmed" | "checked_in" | "completed" | "no_show";

function bookingTone(status: string): BookingStatusTone {
  const key = status.trim().toLowerCase();
  if (key === "confirmed" || key === "checked_in" || key === "completed" || key === "no_show") {
    return key;
  }
  return "completed";
}

export function bookingStatusStyle(status: string): { bar: string; wash: string; text: string } {
  const tone = bookingTone(status);
  switch (tone) {
    case "confirmed":
      return {
        bar: "bg-[var(--visit-status-confirmed)]",
        wash: "bg-[var(--visit-status-confirmed-bg)]",
        text: "text-[var(--visit-status-confirmed)]",
      };
    case "checked_in":
      return {
        bar: "bg-[var(--visit-status-checked-in)]",
        wash: "bg-[var(--visit-status-checked-in-bg)]",
        text: "text-[var(--visit-status-checked-in)]",
      };
    case "completed":
      return {
        bar: "bg-[var(--visit-status-completed)]",
        wash: "bg-[var(--visit-status-completed-bg)]",
        text: "text-[var(--visit-status-completed)]",
      };
    case "no_show":
      return {
        bar: "bg-[var(--visit-status-no-show)]",
        wash: "bg-[var(--visit-status-no-show-bg)]",
        text: "text-[var(--visit-status-no-show)]",
      };
    default: {
      const neverTone: never = tone;
      return neverTone;
    }
  }
}
