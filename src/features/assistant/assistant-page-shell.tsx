"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Download, Send, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadAssistantExport } from "./assistant-export";
import { latestExportSpecFromMessages } from "./assistant-export-spec";
import { refuseCopy } from "./assistant-copy";

function downloadBase64Xlsx(filename: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AssistantPageShell({ gatewayReady }: { gatewayReady: boolean }) {
  const t = useTranslations("pages.assistant");
  const locale = useLocale();
  const uiLocale = locale === "ar" ? "ar" : "en";
  const [input, setInput] = useState("");
  const [exporting, setExporting] = useState(false);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/assistant/chat?locale=${uiLocale}`,
      }),
    [uiLocale],
  );
  const { messages, sendMessage, status, error } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";
  const exportSpec = latestExportSpecFromMessages(messages);
  const errorCopy = error ? refuseCopy(error.message.replace(/^Error:\s*/, ""), uiLocale) : null;

  async function onDownload() {
    if (!exportSpec) return;
    setExporting(true);
    try {
      const file = await downloadAssistantExport(exportSpec);
      downloadBase64Xlsx(file.filename, file.base64);
    } catch (err) {
      toast.error(err instanceof Error ? refuseCopy(err.message, uiLocale) : t("exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <AppListCard>
        <div className="flex min-h-[28rem] flex-col" dir={uiLocale === "ar" ? "rtl" : "ltr"}>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : null}
            {messages.map((message) => (
              <div key={message.id} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {message.role === "user" ? t("you") : t("assistant")}
                </p>
                <div className="whitespace-pre-wrap text-sm text-foreground">
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return <span key={`${message.id}-${index}`}>{part.text}</span>;
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}
            {errorCopy ? <p className="text-sm text-destructive">{errorCopy}</p> : null}
            {!gatewayReady ? (
              <p className="text-sm text-amber-800">{t("gateway")}</p>
            ) : null}
          </div>
          <form
            className="flex items-center gap-2 border-t border-border px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              const text = input.trim();
              if (!text || busy || !gatewayReady) return;
              sendMessage({ text });
              setInput("");
            }}
          >
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
            <Input
              className="h-9"
              value={input}
              disabled={busy || !gatewayReady}
              placeholder={t("placeholder")}
              onChange={(event) => setInput(event.target.value)}
            />
            {exportSpec ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-9 text-primary hover:bg-primary/10"
                disabled={exporting}
                onClick={() => void onDownload()}
              >
                <Download data-icon="inline-start" />
                {t("excel")}
              </Button>
            ) : null}
            <Button type="submit" size="lg" className="h-9" disabled={busy || !gatewayReady}>
              <Send data-icon="inline-start" />
              {t("send")}
            </Button>
          </form>
        </div>
      </AppListCard>
    </AppPage>
  );
}
