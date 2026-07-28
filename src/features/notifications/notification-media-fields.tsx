"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ImageIcon, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { uploadNotificationMedia } from "./notifications-actions";
import type { NotificationMediaItem } from "./types";

type MediaSlotProps = {
  role: NotificationMediaItem["role"];
  objectKey: string | null;
  onChange: (objectKey: string | null) => void;
  label: string;
  hint: string;
  previewClassName?: string;
};

function MediaSlot({
  role,
  objectKey,
  onChange,
  label,
  hint,
  previewClassName = "h-24 w-full rounded-lg object-cover",
}: MediaSlotProps) {
  const t = useTranslations("pages.notifications");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!objectKey) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/storage/signed-url?key=${encodeURIComponent(objectKey)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const json = (await res.json()) as { url?: string };
        return json.url ?? null;
      })
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [objectKey]);

  function handleUpload(file: File) {
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("role", role);
      const result = await uploadNotificationMedia(formData);
      if ("error" in result) {
        toast.error(t(`mediaErrors.${result.error}`, { defaultValue: t("errors.saveFailed") }));
        return;
      }
      onChange(result.objectKey);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {previewUrl ? (
        <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={label} className={previewClassName} />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute end-2 top-2 size-8 cursor-pointer bg-background/90"
            disabled={pending}
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/10">
          <ImageIcon className="size-8 text-muted-foreground/60" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          disabled={pending}
          className="max-w-sm cursor-pointer"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>
    </div>
  );
}

export function NotificationMediaFields({
  bannerObjectKey,
  imageObjectKey,
  onBannerChange,
  onImageChange,
}: {
  bannerObjectKey: string | null;
  imageObjectKey: string | null;
  onBannerChange: (objectKey: string | null) => void;
  onImageChange: (objectKey: string | null) => void;
}) {
  const t = useTranslations("pages.notifications");

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MediaSlot
        role="banner"
        objectKey={bannerObjectKey}
        onChange={onBannerChange}
        label={t("fieldBanner")}
        hint={t("fieldBannerHint")}
        previewClassName="h-32 w-full rounded-lg object-cover"
      />
      <MediaSlot
        role="image"
        objectKey={imageObjectKey}
        onChange={onImageChange}
        label={t("fieldPushImage")}
        hint={t("fieldPushImageHint")}
        previewClassName="h-32 w-full max-w-xs rounded-lg object-cover"
      />
    </div>
  );
}

export function buildMediaFromKeys(input: {
  bannerObjectKey: string | null;
  imageObjectKey: string | null;
}): NotificationMediaItem[] {
  const media: NotificationMediaItem[] = [];
  if (input.bannerObjectKey) {
    media.push({ role: "banner", type: "image", object_key: input.bannerObjectKey });
  }
  if (input.imageObjectKey) {
    media.push({ role: "image", type: "image", object_key: input.imageObjectKey });
  }
  return media;
}
