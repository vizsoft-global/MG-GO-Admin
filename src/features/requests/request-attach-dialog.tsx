"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Paperclip, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RequestDecisionAttachment } from "./types";

type DraftFile = {
  name: string;
  type: string;
  size: number;
  file: File;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RequestAttachDialog({
  open,
  onOpenChange,
  action,
  requestCode,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "attach_send" | "attach_breakdown" | null;
  requestCode: string;
  submitting: boolean;
  onSubmit: (files: File[]) => void;
}) {
  const t = useTranslations("pages.requests.detail.attach");
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<DraftFile[]>([]);

  useEffect(() => {
    if (!open) setFiles([]);
  }, [open]);

  const title =
    action === "attach_breakdown" ? t("titleBreakdown") : t("titleSend");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(560px,96vw)] overflow-visible pt-4"
        showCloseButton
        closeOutside
      >
        <div className="space-y-3 px-5">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            className="sr-only"
            onChange={(event) => {
              const next = Array.from(event.target.files ?? []).map((file) => ({
                name: file.name,
                type: file.type,
                size: file.size,
                file,
              }));
              setFiles((current) => [...current, ...next]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm",
              "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
            )}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
            {t("chooseFile")}
          </button>
          {files.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">{t("hint")}</p>
          ) : (
            <ul className="space-y-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-700"
                >
                  <span className="min-w-0 truncate">
                    {file.name}
                    <span className="ms-1.5 text-[10px] text-emerald-700/80">
                      {formatSize(file.size)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    onClick={() =>
                      setFiles((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">{t("remove")}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-2 pb-2 pt-3">
          <AppModalFooter title={title} subtitle={t("subtitle", { code: requestCode })}>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={submitting || files.length === 0}
              onClick={() => onSubmit(files.map((row) => row.file))}
            >
              {title}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function fileToDecisionAttachmentPayload(file: File): Promise<{
  name: string;
  type: string;
  base64: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read_failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        base64: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.readAsDataURL(file);
  });
}

export type { RequestDecisionAttachment };
