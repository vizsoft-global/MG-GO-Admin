import { PAYLOAD_VERSION } from "./constants";
import type { ActionPayload, NotificationActionType } from "./types";

export function buildActionPayload(input: {
  actionType: NotificationActionType;
  actionParams?: Record<string, unknown>;
  deepLink?: string | null;
  campaignId?: string;
}): ActionPayload {
  return {
    action_type: input.actionType,
    action_params: input.actionParams ?? {},
    deep_link: input.deepLink ?? null,
    payload_version: PAYLOAD_VERSION,
    ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
  };
}

export function buildFcmDataPayload(input: {
  campaignId: string;
  dispatchItemId?: string | null;
  action: ActionPayload;
  category: string;
  priority: string;
  media?: Array<{ role: string; type: string; object_key: string; alt?: string }>;
  imageUrl?: string | null;
}): Record<string, string> {
  const payload: Record<string, string> = {
    campaign_id: input.campaignId,
    payload_version: String(input.action.payload_version),
    action_type: input.action.action_type,
    action_params: JSON.stringify(input.action.action_params),
    category: input.category,
    priority: input.priority,
    ...(input.action.deep_link ? { deep_link: input.action.deep_link } : {}),
    ...(input.dispatchItemId ? { dispatch_item_id: input.dispatchItemId } : {}),
  };

  if (input.media && input.media.length > 0) {
    payload.media = JSON.stringify(input.media);
  }
  if (input.imageUrl) {
    payload.image_url = input.imageUrl;
  }

  return payload;
}

export function previewPayloadSchema(
  action: ActionPayload,
  media?: Array<{ role: string; type: string; object_key: string; alt?: string }>,
): string {
  return JSON.stringify(
    {
      version: action.payload_version,
      action_type: action.action_type,
      action_params: action.action_params,
      deep_link: action.deep_link,
      ...(media && media.length > 0 ? { media } : {}),
    },
    null,
    2,
  );
}
