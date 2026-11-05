"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MAX_SERVICE_ATTACHMENTS,
  MAX_SERVICE_ATTACHMENT_BYTES,
  SERVICE_ATTACHMENT_ACCEPT,
  formatAttachmentSize,
  serviceUploadBlockReason,
} from "./service-attachments-model";
import { resolveServiceAttachments, uploadServiceAttachment } from "./service-actions";
import type { ServiceAttachmentMeta } from "./types";

const KNOWN_CODES = new Set([
  "too_many_attachments",
  "file_empty",
  "file_too_large",
  "invalid_content_type",
  "missing_fields",
  "upload_failed",
  "missing_vehicle",
]);

/**
 * Invoices and photos on a service record.
 *
 * The file is uploaded as soon as it is picked and the returned key is what the
 * record stores, so leaving the form without saving leaves an unreferenced object
 * rather than a record that promises a file nobody can open — the same trade the
 * accident strip makes. Removal only drops the reference; the object stays in R2
 * under the vehicle's folder, where its own retention sweep owns it.
 */
export function ServiceAttachments({
  vehicleId,
  attachments,
  canManage,
  onChange,
}: {
  vehicleId: string;
  attachments: readonly ServiceAttachmentMeta[];
  canManage: boolean;
  onChange: (next: ServiceAttachmentMeta[]) => void;
}) {
  const t = useTranslations("pages.fleetService.attachments");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const full = attachments.length >= MAX_SERVICE_ATTACHMENTS;
  const limitMb = Math.round(MAX_SERVICE_ATTACHMENT_BYTES / (1024 * 1024));

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    let count = attachments.length;
    const added: ServiceAttachmentMeta[] = [];
    for (const file of Array.from(files)) {
      const block = serviceUploadBlockReason({
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
      const result = await uploadServiceAttachment(formData);
      setUploading((value) => Math.max(0, value - 1));
      if ("error" in result) {
        setError(result.error);
        break;
      }
      added.push(result.attachment);
      count += 1;
    }
    if (inputRef.current) inputRef.current.value = "";
    if (added.length > 0) onChange([...attachments, ...added]);
  }

  async function open(key: string) {
    const resolved = await resolveServiceAttachments([key]);
    const url = resolved[0]?.url;
    if (!url) {
      toast.error(t("openFailed"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function remove(key: string) {
    onChange(attachments.filter((attachment) => attachment.key !== key));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("limit", {
            count: attachments.length,
            max: MAX_SERVICE_ATTACHMENTS,
            mb: limitMb,
          })}
        </p>
        {canManage ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={SERVICE_ATTACHMENT_ACCEPT}
              multiple
              hidden
              onChange={(event) => void handleFiles(event.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={full || uploading > 0 || !vehicleId}
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
          {KNOWN_CODES.has(error) ? t(`errors.${error}`) : t("errors.upload_failed")}
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
              className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {attachment.file_name ?? attachment.key.split("/").pop() ?? attachment.key}
                </p>
                <p className="truncate text-[11px] text-emerald-700/70">
                  {[formatAttachmentSize(attachment.size), attachment.content_type]
                    .filter(Boolean)
                    .join(" · ") || attachment.key}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-2 text-primary hover:bg-primary/10"
                onClick={() => void open(attachment.key)}
              >
                <ExternalLink className="me-1 h-3.5 w-3.5" />
                {t("open")}
              </Button>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                  aria-label={t("remove")}
                  title={t("remove")}
                  onClick={() => remove(attachment.key)}
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
