import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai";
import { lastUserText, refuseCopy } from "@/features/assistant/assistant-copy";
import { ASSISTANT_V1_MAX_STEPS, ASSISTANT_V1_MODEL, isGatewayConfigured } from "@/features/assistant/assistant-contract";
import { lastEntityFocus } from "@/features/assistant/assistant-focus";
import { assistantSystemPrompt } from "@/features/assistant/assistant-prompt";
import { refuseUserText } from "@/features/assistant/assistant-refuse";
import { createAssistantTools } from "@/features/assistant/assistant-tools";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";

export const maxDuration = 60;

function localeFromRequest(req: Request, bodyLocale?: string): "en" | "ar" {
  const url = new URL(req.url);
  const q = url.searchParams.get("locale") ?? bodyLocale ?? "";
  return q === "ar" ? "ar" : "en";
}

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

  const body = (await req.json()) as { messages?: UIMessage[]; locale?: string };
  const locale = localeFromRequest(req, body.locale);
  const messages = body.messages ?? [];
  const userText = lastUserText(messages);
  const refused = refuseUserText(userText);
  if (refused) {
    return Response.json({ error: refused, message: refuseCopy(refused, locale) }, { status: 400 });
  }

  const focus = lastEntityFocus(messages);
  void logAdminRead("assistant", "assistant.chat", { tools: "allowlist", locale });

  const result = streamText({
    model: ASSISTANT_V1_MODEL,
    system: assistantSystemPrompt(locale, focus),
    messages: await convertToModelMessages(messages),
    tools: createAssistantTools(),
    stopWhen: isStepCount(ASSISTANT_V1_MAX_STEPS),
  });

  return result.toUIMessageStreamResponse();
}
