"use client";

import { createElement } from "react";
import { useTranslations } from "next-intl";
import { Info, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LAUNCHER_BRAND, launcherTileHex } from "@/lib/menu/module-colors";
import { resolveIcon } from "@/lib/menu/menu-registry";
import { cn } from "@/lib/utils";

export type PreviewAppRow = {
  id: string;
  label: string;
  iconName: string;
  subViewLabels: string[];
};

export function AccessPreviewPane({
  name,
  apps,
  totalApps,
  unsavedCount,
  saving,
  disabled,
  onDiscard,
  onSave,
  onCopy,
}: {
  name: string;
  apps: PreviewAppRow[];
  totalApps: number;
  unsavedCount: number;
  saving?: boolean;
  disabled?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onCopy: () => void;
}) {
  const t = useTranslations("pages.settings.accessControl");

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-auto border-[#E4E4E7] bg-[#F1F2F4] p-4 lg:border-s">
      <p className="text-[10px] font-semibold uppercase tracking-[0.8px] text-[#5B6371]">
        {t("eyebrowPreview")}
      </p>

      <div className="flex items-center gap-1.5">
        <Users className="size-3.5 shrink-0 text-[#5B6371]" aria-hidden />
        <p className="text-sm text-[#111827]">{t("previewTitle", { name })}</p>
      </div>

      <div
        className="flex flex-col gap-3 rounded-xl p-2.5"
        style={{ backgroundColor: LAUNCHER_BRAND.canvas }}
      >
        <div className="flex items-center gap-2">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md text-[9px] font-bold text-[#574500]"
            style={{ backgroundColor: LAUNCHER_BRAND.logoChip }}
          >
            MG
          </span>
          <div className="min-w-0">
            <p className="truncate text-[10.5px] font-semibold text-white">{name}</p>
            <p className="truncate text-[8.5px]" style={{ color: LAUNCHER_BRAND.muted }}>
              {t("previewRole")}
            </p>
          </div>
        </div>

        {apps.length === 0 ? (
          <p className="px-1 py-2 text-[10px]" style={{ color: LAUNCHER_BRAND.muted }}>
            {t("previewEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {apps.map((app) => (
              <li key={app.id} className="flex items-center gap-2">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-md"
                  style={{ backgroundColor: launcherTileHex(app.id) }}
                >
                  {createElement(resolveIcon(app.iconName), { className: "size-3.5 text-white" })}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-medium text-[#E4E4E7]">{app.label}</p>
                  <p className="truncate text-[8.5px]" style={{ color: LAUNCHER_BRAND.muted }}>
                    {app.subViewLabels.map((view) => `✓ ${view}`).join("  ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-[#E4E4E7] bg-white p-2.5">
        <p className="text-[10.5px] font-medium text-[#18181B]">
          {t("launcherShows", { shown: apps.length, total: totalApps })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {apps.map((app) => (
            <span
              key={app.id}
              className="grid size-6 place-items-center rounded-md"
              style={{ backgroundColor: launcherTileHex(app.id) }}
              title={app.label}
            >
              {createElement(resolveIcon(app.iconName), { className: "size-3.5 text-white" })}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-[7px] rounded-lg bg-[#E9EAEC] p-2.5">
        <Info className="size-3.5 shrink-0 text-[#71717A]" aria-hidden />
        <p className="text-[10px] leading-relaxed text-[#71717A]">{t("previewHelper")}</p>
      </div>

      <p className="text-end text-[10.5px] text-[#9CA3AF]">
        {t("unsavedCount", { count: unsavedCount })}
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 flex-1 cursor-pointer rounded-lg border-[#D4D4D8] bg-white text-[12.5px]"
          onClick={onDiscard}
          disabled={saving || unsavedCount === 0}
        >
          {t("discard")}
        </Button>
        <Button
          type="button"
          className="h-10 flex-1 cursor-pointer rounded-lg bg-[#18181B] text-[12.5px] text-white hover:bg-[#27272A]"
          onClick={onSave}
          disabled={saving || unsavedCount === 0}
        >
          {saving ? t("saving") : t("save")}
        </Button>
      </div>

      <button
        type="button"
        onClick={onCopy}
        disabled={disabled}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center justify-center rounded-lg border border-[#18181B] bg-white text-[11.5px] font-medium text-[#18181B] transition-colors duration-150",
          "hover:bg-[#FAFAFA] disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {t("copyAccessShort")}
      </button>
    </aside>
  );
}
