export const CANCEL_REASON_CODES = [
  "customer_no_show",
  "customer_refused",
  "wrong_address",
  "restaurant_issue",
  "accident",
  "other",
] as const;

export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export type ParsedCancelReason = {
  code: CancelReasonCode;
  note: string | null;
};

export function isCancelReasonCode(value: string): value is CancelReasonCode {
  return (CANCEL_REASON_CODES as readonly string[]).includes(value);
}

/** Parses `code|optional note` stored in deliveries.cancel_reason. */
export function parseCancelReason(raw: string | null | undefined): ParsedCancelReason | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx >= 0) {
    const codePart = trimmed.slice(0, pipeIdx).trim();
    const notePart = trimmed.slice(pipeIdx + 1).trim();
    const code = isCancelReasonCode(codePart) ? codePart : "other";
    return { code, note: notePart || null };
  }

  if (isCancelReasonCode(trimmed)) {
    return { code: trimmed, note: null };
  }

  return { code: "other", note: trimmed };
}

export function cancelReasonMessageKey(code: CancelReasonCode): string {
  return `cancelReason.${code}`;
}
