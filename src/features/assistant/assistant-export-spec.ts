import {
  isAssistantExportKind,
  type AssistantExportSpec,
} from "./assistant-contract";

export function exportSpecFromUnknown(payload: unknown): AssistantExportSpec | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const raw =
    obj.export && typeof obj.export === "object"
      ? (obj.export as Record<string, unknown>)
      : obj;
  const kind = String(raw.kind ?? "");
  if (!isAssistantExportKind(kind)) return null;
  const from = String(raw.from ?? "").slice(0, 10);
  const to = String(raw.to ?? "").slice(0, 10);
  if (!from || !to) return null;
  const filters =
    raw.filters && typeof raw.filters === "object"
      ? (raw.filters as Record<string, string | undefined>)
      : {};
  return { kind, from, to, filters };
}

export function latestExportSpecFromMessages(
  messages: Array<{ role?: string; parts?: Array<{ type?: string; output?: unknown; state?: string }> }>,
): AssistantExportSpec | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (!part.type?.startsWith("tool-")) continue;
      const spec = exportSpecFromUnknown(part.output);
      if (spec) return spec;
    }
  }
  return null;
}
