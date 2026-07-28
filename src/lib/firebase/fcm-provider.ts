import { getFirebaseMessaging } from "./admin";

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

  const payload = messages.map((message) => ({
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

  const response = await messaging.sendEach(payload);
  const errors: PushBatchResult["errors"] = [];
  const messageIds: PushBatchResult["messageIds"] = [];

  response.responses.forEach((item, index) => {
    const token = messages[index]?.token ?? "";
    if (item.success && item.messageId) {
      messageIds.push({ token, messageId: item.messageId });
      return;
    }
    errors.push({
      token,
      code: item.error?.code ?? "unknown",
      message: item.error?.message ?? "send_failed",
    });
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    errors,
    messageIds,
  };
}
