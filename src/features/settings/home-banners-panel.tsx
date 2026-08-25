"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ImageIcon, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppFormSection } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Switch } from "@/components/ui/switch";
import {
  type HomeBannerLookups,
  type HomeBannerOption,
  type HomeBannerRow,
} from "./home-banners";
import { deleteHomeBanner, saveHomeBanner } from "./home-banners-actions";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function TargetPicks({
  label,
  placeholder,
  recentsKey,
  options,
  selected,
  onChange,
}: {
  label: string;
  placeholder: string;
  recentsKey: string;
  options: HomeBannerOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const items = options.map((option) => ({
    value: option.id,
    label: option.name,
    keywords: [option.name],
  }));
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <SearchSelect
        items={items}
        value={null}
        onChange={(id) => {
          if (!id || selected.includes(id)) return;
          onChange([...selected, id]);
        }}
        placeholder={placeholder}
        searchPlaceholder={placeholder}
        recentsKey={recentsKey}
        clearable={false}
      />
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const name = options.find((option) => option.id === id)?.name ?? id;
            return (
              <ToggleChip
                key={id}
                selected
                onClick={() => onChange(selected.filter((item) => item !== id))}
              >
                {name}
              </ToggleChip>
            );
          })}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">All drivers</p>
      )}
    </div>
  );
}

export function HomeBannersPanel({
  banners,
  lookups,
}: {
  banners: HomeBannerRow[];
  lookups: HomeBannerLookups;
}) {
  const t = useTranslations("pages.settings.driverApp.banners");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HomeBannerRow | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <AppFormSection title={t("title")} description={t("subtitle")}>
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button
            type="button"
            className="h-9"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("add")}
          </Button>
        </div>
        {banners.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {banners.map((banner) => (
              <li
                key={banner.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={banner.image_url}
                  alt=""
                  className="h-12 w-20 rounded-lg border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {banner.caption_en || banner.caption_ar || t("untitled")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {banner.is_active ? t("active") : t("inactive")}
                    {banner.zone_ids.length +
                      banner.partner_ids.length +
                      banner.driver_group_ids.length ===
                    0
                      ? ` · ${t("everyone")}`
                      : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 text-primary hover:bg-primary/10"
                  onClick={() => {
                    setEditing(banner);
                    setOpen(true);
                  }}
                >
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    startTransition(async () => {
                      const result = await deleteHomeBanner(locale, banner.id);
                      if (result.error) {
                        toast.error(t("errors.saveFailed"), {
                          description: result.errorDetail,
                        });
                        return;
                      }
                      toast.success(t("deleted"));
                    });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BannerDialog
        open={open}
        banner={editing}
        lookups={lookups}
        pending={isPending}
        onOpenChange={setOpen}
        onSave={(formData) => {
          startTransition(async () => {
            const result = await saveHomeBanner(locale, formData);
            if (result.error) {
              toast.error(t(`errors.${result.error}` as "errors.saveFailed"), {
                description: result.errorDetail,
              });
              return;
            }
            toast.success(t("saved"));
            setOpen(false);
          });
        }}
      />
    </AppFormSection>
  );
}

function BannerDialog({
  open,
  banner,
  lookups,
  pending,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  banner: HomeBannerRow | null;
  lookups: HomeBannerLookups;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (formData: FormData) => void;
}) {
  const t = useTranslations("pages.settings.driverApp.banners");
  const fileRef = useRef<HTMLInputElement>(null);
  const [captionEn, setCaptionEn] = useState("");
  const [captionAr, setCaptionAr] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCaptionEn(banner?.caption_en ?? "");
    setCaptionAr(banner?.caption_ar ?? "");
    setDeepLink(banner?.deep_link ?? "");
    setStartsAt(toLocalInput(banner?.starts_at ?? null));
    setEndsAt(toLocalInput(banner?.ends_at ?? null));
    setSortOrder(String(banner?.sort_order ?? 0));
    setIsActive(banner?.is_active ?? true);
    setZoneIds(banner?.zone_ids ?? []);
    setPartnerIds(banner?.partner_ids ?? []);
    setGroupIds(banner?.driver_group_ids ?? []);
    setPreview(banner?.image_url ?? null);
  }, [open, banner]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] overflow-visible px-5 py-4"
      >
        <form
          className="space-y-3 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData();
            if (banner?.id) formData.set("id", banner.id);
            formData.set("caption_en", captionEn);
            formData.set("caption_ar", captionAr);
            formData.set("deep_link", deepLink);
            formData.set("starts_at", fromLocalInput(startsAt));
            formData.set("ends_at", fromLocalInput(endsAt));
            formData.set("sort_order", sortOrder);
            formData.set("is_active", String(isActive));
            formData.set("zone_ids", JSON.stringify(zoneIds));
            formData.set("partner_ids", JSON.stringify(partnerIds));
            formData.set("driver_group_ids", JSON.stringify(groupIds));
            const file = fileRef.current?.files?.[0];
            if (file) formData.set("image", file);
            onSave(formData);
          }}
        >
          <div className="space-y-2">
            <Label>{t("image")}</Label>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-28 w-full rounded-xl border border-border object-cover" />
            ) : (
              <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
                <ImageIcon className="size-6" />
              </div>
            )}
            <Input
              ref={fileRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              className="h-9"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setPreview(file ? URL.createObjectURL(file) : banner?.image_url ?? null);
              }}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="banner-caption-en">{t("captionEn")}</Label>
              <Input id="banner-caption-en" className="h-9" value={captionEn} onChange={(e) => setCaptionEn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="banner-caption-ar">{t("captionAr")}</Label>
              <Input id="banner-caption-ar" className="h-9" value={captionAr} onChange={(e) => setCaptionAr(e.target.value)} dir="rtl" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="banner-start">{t("startsAt")}</Label>
              <Input id="banner-start" type="datetime-local" className="h-9" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="banner-end">{t("endsAt")}</Label>
              <Input id="banner-end" type="datetime-local" className="h-9" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="banner-sort">{t("sortOrder")}</Label>
              <Input id="banner-sort" type="number" className="h-9" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="banner-link">{t("deepLink")}</Label>
            <Input id="banner-link" className="h-9" value={deepLink} onChange={(e) => setDeepLink(e.target.value)} placeholder="/earnings" />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <TargetPicks
              label={t("zones")}
              placeholder={t("searchZones")}
              recentsKey="home-banner-zones"
              options={lookups.zones}
              selected={zoneIds}
              onChange={setZoneIds}
            />
            <TargetPicks
              label={t("partners")}
              placeholder={t("searchPartners")}
              recentsKey="home-banner-partners"
              options={lookups.partners}
              selected={partnerIds}
              onChange={setPartnerIds}
            />
            <TargetPicks
              label={t("groups")}
              placeholder={t("searchGroups")}
              recentsKey="home-banner-groups"
              options={lookups.groups}
              selected={groupIds}
              onChange={setGroupIds}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <Label htmlFor="banner-active">{t("active")}</Label>
            <Switch id="banner-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <AppModalFooter title={banner ? t("edit") : t("add")} subtitle={t("subtitle")}>
            <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="h-9" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </AppModalFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
