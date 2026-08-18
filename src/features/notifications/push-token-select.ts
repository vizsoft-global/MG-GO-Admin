export type PushTokenCandidate = {
  id: string;
  driver_id: string;
  token: string;
  last_seen_at?: string | null;
};

/**
 * One FCM token per driver: the one seen most recently.
 *
 * `Map` insertion from an unordered query used to keep whichever row arrived
 * last, so a stale KW-project token could win over the phone's current one.
 */
export function pickLatestPushTokenByDriver(
  tokens: PushTokenCandidate[],
): Map<string, PushTokenCandidate> {
  const byDriver = new Map<string, PushTokenCandidate>();
  for (const token of tokens) {
    const current = byDriver.get(token.driver_id);
    if (!current) {
      byDriver.set(token.driver_id, token);
      continue;
    }
    const currentSeen = Date.parse(current.last_seen_at ?? "") || 0;
    const nextSeen = Date.parse(token.last_seen_at ?? "") || 0;
    if (nextSeen >= currentSeen) {
      byDriver.set(token.driver_id, token);
    }
  }
  return byDriver;
}
