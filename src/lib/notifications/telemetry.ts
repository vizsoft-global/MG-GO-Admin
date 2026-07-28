export type NotificationTelemetryEvent = {
  eventName:
    | "notification_sent"
    | "notification_delivered"
    | "notification_opened"
    | "notification_clicked"
    | "notification_failed";
  campaignId: string;
  dispatchRunId: string;
  recipientId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

/**
 * Server-side telemetry bridge placeholder.
 * Firebase client SDK events should be emitted by mobile/web clients;
 * this method records backend lifecycle telemetry hooks.
 */
export async function recordNotificationTelemetry(
  _event: NotificationTelemetryEvent,
): Promise<void> {
  // Intentionally no-op for now. A follow-up can route this to
  // BigQuery/Firebase Analytics Measurement Protocol if required.
}
