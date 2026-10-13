/**
 * Read-only timing of the notification send path (audience + token lookup).
 * Write methods and FCM are not called. Callers that need a hard guard use
 * `throwOnWrite`.
 */

export type AudienceReads = {
  listLiveDriverIds(): Promise<string[]>;
  listActiveTokenDriverIds(): Promise<string[]>;
};

export type NotificationDryRunTiming = {
  audienceMs: number;
  tokenMs: number;
  audienceCount: number;
  tokenCount: number;
};

const WRITE_NAMES = [
  "set",
  "update",
  "create",
  "delete",
  "add",
  "commit",
  "flush",
  "runTransaction",
  "bulkWriter",
  "sendEach",
] as const;

export type WriteName = (typeof WRITE_NAMES)[number];

export function throwOnWrite(name: string): never {
  throw new Error(`dry_run_write:${name}`);
}

export function writeMethods(): Record<WriteName, () => never> {
  const methods = {} as Record<WriteName, () => never>;
  for (const name of WRITE_NAMES) {
    methods[name] = () => throwOnWrite(name);
  }
  return methods;
}

export async function timeNotificationSendReads(
  db: AudienceReads,
): Promise<NotificationDryRunTiming> {
  const audienceStarted = Date.now();
  const driverIds = await db.listLiveDriverIds();
  const audienceMs = Date.now() - audienceStarted;
  const allowed = new Set(driverIds);

  const tokenStarted = Date.now();
  const tokenDriverIds = await db.listActiveTokenDriverIds();
  let tokenCount = 0;
  for (const driverId of tokenDriverIds) {
    if (allowed.has(driverId)) tokenCount += 1;
  }
  const tokenMs = Date.now() - tokenStarted;

  return {
    audienceMs,
    tokenMs,
    audienceCount: driverIds.length,
    tokenCount,
  };
}
