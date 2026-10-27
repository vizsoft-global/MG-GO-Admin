"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImagePlus, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ICON_MAP, ICON_NAMES } from "@/lib/menu/menu-registry";
import { sanitizeMenuIconColor, sanitizeMenuIconUrl } from "@/lib/menu/menu-icon";
import { uploadMenuIcon } from "@/features/menu-editor/menu-icon-actions";
import { cn } from "@/lib/utils";

export type MenuIconValue = {
  icon: string;
  iconUrl?: string;
  iconColor?: string;
};

export function IconPicker({
  value,
  onChange,
  compact = false,
}: {
  value: MenuIconValue;
  onChange: (next: MenuIconValue) => void;
  compact?: boolean;
}) {
  const t = useTranslations("pages.settings.menuEditor");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const custom = sanitizeMenuIconUrl(value.iconUrl);
  const color = sanitizeMenuIconColor(value.iconColor);
  const Icon = ICON_MAP[value.icon] ?? LayoutDashboard;
  const filtered = ICON_NAMES.filter((name) => name.toLowerCase().includes(query.toLowerCase()));

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await uploadMenuIcon(body);
      if ("error" in result) {
        const key =
          result.error === "icon_too_large"
            ? "iconTooLarge"
            : result.error === "icon_type"
              ? "iconType"
              : "iconUploadFailed";
        toast.error(t(key));
        return;
      }
      onChange({ icon: value.icon, iconUrl: result.url, iconColor: color });
    } catch {
      toast.error(t("iconUploadFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(
          "flex items-center justify-center rounded-md border border-border transition-colors hover:bg-muted",
          compact ? "size-7" : "size-9",
        )}
        style={color ? { backgroundColor: color } : undefined}
        aria-label={t("pickIcon")}
      >
        {custom ? (
          <img src={custom} alt="" className={compact ? "size-3.5 object-contain" : "size-4 object-contain"} />
        ) : (
          <Icon className={compact ? "size-3.5" : "size-4"} />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-2" align="start">
        <Input
          placeholder={t("searchIcons")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9"
        />
        <div className="grid max-h-40 grid-cols-7 gap-1 overflow-y-auto">
          {filtered.map((name) => {
            const Glyph = ICON_MAP[name];
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onChange({ icon: name, iconUrl: undefined, iconColor: color });
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted",
                  !custom && value.icon === name && "bg-primary/15 ring-1 ring-primary",
                )}
                title={name}
              >
                <Glyph className="h-4 w-4" />
              </button>
            );
          })}
        </div>
        <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{t("iconColor")}</span>
          <input
            type="color"
            value={color ?? "#27273F"}
            onChange={(event) =>
              onChange({
                icon: value.icon,
                iconUrl: custom,
                iconColor: sanitizeMenuIconColor(event.target.value),
              })
            }
            className="size-7 cursor-pointer rounded-md border border-border bg-transparent p-0"
            aria-label={t("iconColor")}
          />
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full cursor-pointer gap-2"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="size-4" />
          {uploading ? t("iconUploading") : t("uploadIcon")}
        </Button>
        {custom || color ? (
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full cursor-pointer text-destructive hover:bg-destructive/10"
            onClick={() => onChange({ icon: value.icon, iconUrl: undefined, iconColor: undefined })}
          >
            {t("clearIcon")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
