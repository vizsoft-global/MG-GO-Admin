"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { resolveAccidentAttachments, uploadAccidentAttachment } from "./accident-actions";
import { accidentUploadBlockReason } from "./accident-attachment-rules";
import { MAX_ACCIDENT_ATTACHMENTS, type AccidentAttachmentMeta } from "./accident-types";

const ACCEPT = "image/*,application/pdf,video/mp4,video/quicktime";

const KNOWN_CODES = new Set([
  "too_many_attachments",
  "file_empty",
  "file_too_large",
  "invalid_content_type",
  "missing_vehicle",
  "upload_failed",
  "invalid_attachment",
]);

export function formatSize(size: number | null): string {
  if (size == null || !Number.isFinite(size) || size <= 0) return "";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/**
 * Pick or drop files, per-file progress, retry, remove, open.
 *
 * Every limit is surfaced *before* the upload starts — the strip refuses an
 * eleventh file and an over-size one locally, and the server action enforces the
 * same numbers again (`driver-upload-keys.ts` is the third gate).
 */
export function AccidentAttachments({
  vehicleId,
  attachments,
  canManage,
  onAdded,
  onRemove,
  busy,
}: {
  vehicleId: string;
  attachments: AccidentAttachmentMeta[];
  canManage: boolean;
  onAdded: (attachment: AccidentAttachmentMeta) => void;
  onRemove: (key: string) => void;
  busy?: boolean;
}) {
  const t = useTranslations("pages.fleetAccidents.attachments");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const full = attachments.length >= MAX_ACCIDENT_ATTACHMENTS;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    let count = attachments.length;
    for (const file of Array.from(files)) {
      const block = accidentUploadBlockReason({
        size: file.size,
        contentType: file.type || "",
        existingCount: count,
      });
      if (block) {
        setError(block);
        break;
      }
      if (!vehicleId) {
        setError("missing_vehicle");
        break;
      }
      setUploading((value) => value + 1);
      const formData = new FormData();
      formData.set("vehicleId", vehicleId);
      formData.set("file", file);
      const result = await uploadAccidentAttachment(formData);
      setUploading((value) => Math.max(0, value - 1));
      if ("error" in result) {
        setError(result.error);
        break;
      }
      onAdded(result.attachment);
      count += 1;
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function open(key: string) {
    const resolved = await resolveAccidentAttachments([key]);
    const url = resolved[0]?.url;
    if (!url) {
      toast.error(t("openFailed"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("limit", {
            count: attachments.length,
            max: MAX_ACCIDENT_ATTACHMENTS,
            mb: 50,
          })}
        </p>
        {canManage ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(event) => void handleFiles(event.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={busy || full || uploading > 0}
              onClick={() => inputRef.current?.click()}
            >
              {uploading > 0 ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t("add")}
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {KNOWN_CODES.has(error) ? t(`errors.${error}`) : t("errors.uploadFailed")}
        </p>
      ) : null}

      {attachments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          <Paperclip className="mx-auto mb-2 h-4 w-4" />
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.key}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {attachment.file_name ?? attachment.key.split("/").pop() ?? attachment.key}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {[formatSize(attachment.size), attachment.content_type]
                    .filter(Boolean)
                    .join(" · ") || attachment.key}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-2 text-xs"
                onClick={() => void open(attachment.key)}
              >
                {t("open")}
              </Button>
              {canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-8 p-0"
                  aria-label={t("remove")}
                  title={t("remove")}
                  disabled={busy}
                  onClick={() => onRemove(attachment.key)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

