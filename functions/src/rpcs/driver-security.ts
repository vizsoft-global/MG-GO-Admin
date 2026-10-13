/**
 * Rider security events — port of `driver_log_security_event` (`20260908160000`).
 *
 * Flutter sends `info` / `warning` / `blocked` (not the SQL low/medium/high set).
 * Both sets are accepted so a queued event is not refused forever.
 */
import { onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { requireRider, riderError } from "../core/rider";
import { logDriverOperation, pick, pickObject, pickText, type Dict } from "./_shared";

const SECURITY_EVENTS = "driver_security_events";
const SEVERITIES = new Set(["info", "warning", "blocked", "low", "medium", "high"]);

export function normalizeSecuritySeverity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!SEVERITIES.has(value)) return null;
  return value;
}

export const driverLogSecurityEvent = onCall(async (request) => {
  const rider = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const eventType = pickText(data, "p_event_type", "eventType", "event_type");
  if (!eventType) throw riderError("invalid-argument", "event_type_required");

  const severityRaw = pick(data, "p_severity", "severity");
  const severity = normalizeSecuritySeverity(severityRaw ?? "warning");
  if (!severity) throw riderError("invalid-argument", "invalid_severity");

  const context = pickObject(data, "p_context", "context") ?? {};
  const device = pickObject(data, "p_device", "device");
  const stored: Dict = device ? { ...context, device } : { ...context };
  const now = Timestamp.now();
  const id = crypto.randomUUID();

  await getFirestore().collection(SECURITY_EVENTS).doc(id).set({
    driver_id: rider.uid,
    event_type: eventType,
    severity,
    context: stored,
    created_at: now,
  });

  await logDriverOperation({
    driverId: rider.uid,
    module: "security",
    action: `security.${eventType}`,
    actor: "driver_log_security_event",
    success: true,
    recordType: "security_event",
    recordId: id,
    detail: { severity, ...stored },
  });

  return { ok: true, id };
});
