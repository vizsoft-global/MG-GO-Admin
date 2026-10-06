"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { commentBodyValid } from "./request-comments";
import { useAddRequestComment } from "./use-requests";
import type { RequestComment } from "./types";

export function RequestCommentsThread({
  requestId,
  comments,
}: {
  requestId: string;
  comments: RequestComment[];
}) {
  const t = useTranslations("pages.requests.detail.comments");
  const add = useAddRequestComment(requestId);
  const [body, setBody] = useState("");

  async function submit() {
    if (!commentBodyValid(body)) {
      toast.error(t("required"));
      return;
    }
    const result = await add.mutateAsync(body.trim());
    if (!result.ok) {
      toast.error(result.error ?? t("failed"));
      return;
    }
    setBody("");
    toast.success(t("saved"));
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold">
        <MessageSquare className="size-3.5" />
        {t("title")}
      </h2>
      {comments.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((row) => (
            <li key={row.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
              <p className="text-[11px] font-semibold">{row.author_name ?? "—"}</p>
              <p className="whitespace-pre-wrap text-sm">{row.body}</p>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        className="mt-3 min-h-16 text-sm"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t("placeholder")}
      />
      <div className="mt-2 flex justify-end">
        <Button type="button" className="h-9" disabled={add.isPending} onClick={() => void submit()}>
          {add.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
          {t("submit")}
        </Button>
      </div>
    </section>
  );
}
