import type { DeliveryListRow } from "./types";

export function proofKeysForDelivery(row: DeliveryListRow): string[] {
  return [row.order_proof_url, row.pickup_proof_url, row.cancel_proof_url]
    .map((k) => k?.trim() ?? "")
    .filter(Boolean);
}
