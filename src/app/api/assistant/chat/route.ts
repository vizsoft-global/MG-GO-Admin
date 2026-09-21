import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai";
import { ASSISTANT_V1_MAX_STEPS, ASSISTANT_V1_MODEL, isGatewayConfigured } from "@/features/assistant/assistant-contract";
import { lastUserText, refuseCopy } from "@/features/assistant/assistant-copy";
import { ASSISTANT_V1_SYSTEM_PROMPT } from "@/features/assistant/assistant-prompt";
import { looksArabic, refuseUserText } from "@/features/assistant/assistant-refuse";
import { createAssistantTools } from "@/features/assistant/assistant-tools";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "assistant.view", session.isSuperAdmin)
  ) {
    return Response.json({ error: "not_authorized" }, { status: 403 });
  }

  if (!isGatewayConfigured()) {
    return Response.json({ error: "gateway_not_configured" }, { status: 503 });
  }

  const body = (await req.json()) as { messages?: UIMessage[] };
  const messages = body.messages ?? [];
  const userText = lastUserText(messages);
  const refused =
    looksArabic(userText) ? "unknown_tool" : refuseUserText(userText);
  if (refused) {
    return Response.json({ error: refused, message: refuseCopy(refused) }, { status: 400 });
  }

  void logAdminRead("assistant", "assistant.chat", { tools: "allowlist" });

  const result = streamText({
    model: ASSISTANT_V1_MODEL,
    system: ASSISTANT_V1_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: createAssistantTools(),
    stopWhen: isStepCount(ASSISTANT_V1_MAX_STEPS),
  });

  return result.toUIMessageStreamResponse();
}
