import {
  isAssistantEntityType,
  type AssistantFocus,
  type AssistantEntityType,
} from "./assistant-entity";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function focusFromUnknown(value: unknown): AssistantFocus | null {
  const rec = asRecord(value);
  if (!rec) return null;

  const nestedFocus = asRecord(rec.focus);
  if (nestedFocus) {
    const fromNested = focusFromUnknown(nestedFocus);
    if (fromNested) return fromNested;
  }

  const match = asRecord(rec.match);
  const entity = asRecord(rec.entity);
  const typeRaw = String(
    rec.entity_type ?? match?.entity_type ?? entity?.type ?? entity?.entity_type ?? "",
  );
  const id = String(rec.id ?? match?.id ?? entity?.id ?? "");
  if (!id || !isAssistantEntityType(typeRaw)) return null;
  return {
    entity_type: typeRaw,
    id,
    label: String(rec.label ?? match?.label ?? entity?.label ?? "") || undefined,
    zone_id: rec.zone_id != null ? String(rec.zone_id) : entity?.zone_id != null ? String(entity.zone_id) : undefined,
    driver_id:
      rec.driver_id != null
        ? String(rec.driver_id)
        : entity?.driver_id != null
          ? String(entity.driver_id)
          : typeRaw === "driver"
            ? id
            : undefined,
  };
}

function walkPart(part: unknown): AssistantFocus | null {
  const rec = asRecord(part);
  if (!rec) return null;
  return (
    focusFromUnknown(rec.output) ??
    focusFromUnknown(rec.result) ??
    focusFromUnknown(rec) ??
    null
  );
}

/**
 * Last resolved entity from this-tab chat tool JSON. No database.
 */
export function lastEntityFocus(
  messages: Array<{
    role?: string;
    parts?: unknown[];
    content?: unknown;
  }>,
): AssistantFocus | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role === "user") continue;
    const parts = Array.isArray(message.parts)
      ? message.parts
      : Array.isArray(message.content)
        ? message.content
        : [message];
    for (let p = parts.length - 1; p >= 0; p -= 1) {
      const found = walkPart(parts[p]);
      if (found) return found;
    }
  }
  return null;
}

export function focusLine(focus: AssistantFocus | null): string {
  if (!focus) return "No current entity focus.";
  const extras = [
    focus.label ? `label=${focus.label}` : null,
    focus.zone_id ? `zone_id=${focus.zone_id}` : null,
    focus.driver_id ? `driver_id=${focus.driver_id}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `Current focus: ${focus.entity_type} id=${focus.id}${extras ? ` ${extras}` : ""}`;
}

export function applyFocusId(
  rawId: string | undefined,
  expectedType: AssistantEntityType | undefined,
  focus: AssistantFocus | null,
): string | undefined {
  if (rawId && rawId !== "this" && rawId !== "focus") return rawId;
  if (!focus) return rawId;
  if (expectedType && focus.entity_type !== expectedType) {
    if (expectedType === "driver" && focus.driver_id) return focus.driver_id;
    if (expectedType === "zone" && focus.zone_id) return focus.zone_id;
    return rawId;
  }
  return focus.id;
}
