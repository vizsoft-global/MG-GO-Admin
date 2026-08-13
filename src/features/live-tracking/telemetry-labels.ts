/** Telemetry category → chip tone for the diagnostics feed. */
export type TelemetryCategoryTone =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

const CATEGORY_TONES: Record<string, TelemetryCategoryTone> = {
  lifecycle: "primary",
  screen: "neutral",
  action: "primary",
  permission: "warning",
  network: "warning",
  queue: "success",
  client_error: "danger",
};

export function telemetryCategoryTone(category: string): TelemetryCategoryTone {
  return CATEGORY_TONES[category] ?? "neutral";
}

/** The categories seeded in `driver_telemetry_event_types`, in filter order. */
export const TELEMETRY_CATEGORIES = [
  "lifecycle",
  "screen",
  "action",
  "permission",
  "network",
  "queue",
  "client_error",
] as const;

/**
 * next-intl reads `.` as nesting, so an event name cannot be a message key
 * verbatim: `screen.open` becomes `screen_open`.
 */
export function telemetryMessageKey(eventName: string): string {
  return eventName.replace(/\./g, "_");
}

/**
 * `permission.location_denied` → `Location denied`. An event name can be seeded
 * in the database before anyone adds a translation, so an unlabelled name must
 * still read as English rather than leaving the row blank.
 */
export function humanizeTelemetryEvent(eventName: string): string {
  const tail = eventName.includes(".")
    ? eventName.slice(eventName.indexOf(".") + 1)
    : eventName;
  const words = tail.replace(/[._-]+/g, " ").trim();
  if (!words) return eventName;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function humanizeTelemetryCategory(category: string): string {
  const words = category.replace(/[._-]+/g, " ").trim();
  if (!words) return category;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Clock skew is the reason both timestamps are stored, so it has to be readable
 * at a glance: sub-second skew is noise, minutes are a real diagnosis.
 */
export function formatClockSkew(ms: number | null): string {
  if (ms == null) return "—";
  const abs = Math.abs(ms);
  if (abs < 1000) return `${ms} ms`;
  if (abs < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}
