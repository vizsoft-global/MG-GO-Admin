"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import { cn } from "@/lib/utils";
import { commentBodyValid } from "./request-comments";
import { useAddRequestComment } from "./use-requests";
import type { RequestComment } from "./types";

const COMMENT_STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "—";
}

export function RequestCommentsThread({
  requestId,
  comments,
  heading,
}: {
  requestId: string;
  comments: RequestComment[];
  heading?: string;
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
      <h2 className="mb-2 text-sm font-semibold">
        {heading ?? t("title")} ({comments.length})
      </h2>
      {comments.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((row) => {
            const name = row.author_name ?? "—";
            const stamp = Number.isNaN(new Date(row.created_at).getTime())
              ? ""
              : COMMENT_STAMP.format(new Date(row.created_at));
            return (
              <li key={row.id} className="flex gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    avatarTintFromName(name),
                  )}
                >
                  {initials(name)}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold">
                    {name}
                    {stamp ? <span className="ms-2 font-normal text-muted-foreground">{stamp}</span> : null}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{row.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Input
          className="h-9"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={t("placeholder")}
        />
        <Button
          type="button"
          className="h-9 bg-zinc-950 text-white hover:bg-zinc-800"
          disabled={add.isPending}
          onClick={() => void submit()}
        >
          {add.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
          {t("send")}
        </Button>
      </div>
    </section>
  );
}
