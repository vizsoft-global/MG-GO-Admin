import { getFirebaseMessaging } from "./admin";

// Firebase Admin rejects `sendEach` above 500 messages; callers legitimately
// pass a whole fleet, so the provider owns the chunking.
const FCM_MAX_MESSAGES_PER_CALL = 500;

export type PushMessageInput = {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string | null;
};

export type PushBatchResult = {
  successCount: number;
  failureCount: number;
  errors: Array<{ token: string; code: string; message: string }>;
  messageIds: Array<{ token: string; messageId: string }>;
};

export async function sendPushBatch(messages: PushMessageInput[]): Promise<PushBatchResult> {
  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return {
      successCount: 0,
      failureCount: messages.length,
      errors: messages.map((m) => ({
        token: m.token,
        code: "firebase_not_configured",
        message: "Firebase admin credentials are missing",
      })),
      messageIds: [],
    };
  }

  if (messages.length === 0) {
    return { successCount: 0, failureCount: 0, errors: [], messageIds: [] };
  }

  // FCM rejects any sendEach call carrying more than 500 messages, so a fleet
  // campaign (~600+ riders) used to fail outright with invalid-argument. Split
  // into FCM_MAX_MESSAGES_PER_CALL chunks and aggregate per-chunk results.
  const result: PushBatchResult = {
    successCount: 0,
    failureCount: 0,
    errors: [],
    messageIds: [],
  };

  for (let start = 0; start < messages.length; start += FCM_MAX_MESSAGES_PER_CALL) {
    const chunk = messages.slice(start, start + FCM_MAX_MESSAGES_PER_CALL);
    const payload = chunk.map((message) => ({
      token: message.token,
      notification: {
        title: message.title,
        body: message.body,
        ...(message.imageUrl ? { imageUrl: message.imageUrl } : {}),
      },
      data: message.data ?? {},
      android: {
        priority: "high" as const,
        ...(message.imageUrl ? { notification: { imageUrl: message.imageUrl } } : {}),
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { sound: "default" } },
        ...(message.imageUrl ? { fcm_options: { image: message.imageUrl } } : {}),
      },
    }));

    try {
      const response = await messaging.sendEach(payload);
      result.successCount += response.successCount;
      result.failureCount += response.failureCount;

      response.responses.forEach((item, index) => {
        const token = chunk[index]?.token ?? "";
        if (item.success && item.messageId) {
          result.messageIds.push({ token, messageId: item.messageId });
          return;
        }
        result.errors.push({
          token,
          code: item.error?.code ?? "unknown",
          message: item.error?.message ?? "send_failed",
        });
      });
    } catch (error) {
      // One chunk failing must not discard the successes of the others.
      const err = error as { code?: string; message?: string };
      const code = err.code ?? "unknown";
      const message = err.message ?? "send_failed";
      result.failureCount += chunk.length;
      for (const m of chunk) result.errors.push({ token: m.token, code, message });
    }
  }

  return result;
}
