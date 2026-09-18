export type RescheduleStatus = "awaiting" | "accepted" | "declined";

export type ParsedReschedule = {
  proposedStart: string | null;
  proposedEnd: string | null;
  note: string | null;
  proposedBy: string | null;
  proposedAt: string | null;
  driverNote: string | null;
  status: RescheduleStatus;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseReschedulePayload(payload: unknown): ParsedReschedule | null {
  const root = asRecord(payload);
  if (!root) return null;
  const block = asRecord(root.reschedule);
  if (!block) return null;

  const accepted = block.accepted;
  let status: RescheduleStatus = "awaiting";
  if (accepted === true) status = "accepted";
  else if (accepted === false) status = "declined";

  return {
    proposedStart: asText(block.proposed_start),
    proposedEnd: asText(block.proposed_end),
    note: asText(block.note),
    proposedBy: asText(block.proposed_by),
    proposedAt: asText(block.proposed_at),
    driverNote: asText(block.driver_note),
    status,
  };
}
