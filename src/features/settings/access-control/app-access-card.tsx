"use client";

import { createElement } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";
import {
  APP_ACCESS_LEVELS,
  type AppAccessEntry,
  type AppAccessItem,
  type AppAccessLevel,
} from "@/lib/auth/app-access";
import { launcherTileHex } from "@/lib/menu/module-colors";
import { resolveIcon } from "@/lib/menu/menu-registry";
import type { RequestTypeGrant, RequestTypeOption } from "@/features/settings/staff-access-actions";
import { cn } from "@/lib/utils";

const LEVEL_KEYS: Record<AppAccessLevel, string> = {
  none: "levelNone",
  viewer: "levelViewer",
  user: "levelUser",
  manager: "levelManager",
};

/**
 * Figma `6039:62395` styles every chip below as a flat outline: an active
 * sub-view is a filled grey pill with a solid check, and an inactive one waits
 * on a white pill with a plus. Level selection is the one control filled
 * solid black. The reference is explicit, so the emerald `ToggleChip` rule
 * does not apply inside this screen.
 */
function SubViewChip({
  active,
  label,
  disabled,
  onClick,
}: {
  active: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border px-[7px] text-[10.5px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-black/30 bg-[#F4F4F5] text-[#374151]"
          : "border-[#E4E4E7] bg-white text-[#71717A] hover:bg-[#FAFAFA]",
      )}
    >
      {active ? (
        <Check className="size-2.5 shrink-0 stroke-[3] text-[#18181B]" aria-hidden />
      ) : (
        <Plus className="size-2.5 shrink-0 stroke-[3] text-[#9CA3AF]" aria-hidden />
      )}
      {label}
    </button>
  );
}

export function AppAccessCard({
  entry,
  item,
  iconName,
  label,
  disabled,
  requestTypes,
  grants,
  onLevel,
  onToggleSubView,
  onSides,
  onToggleType,
}: {
  entry: AppAccessEntry;
  item: AppAccessItem;
  iconName: string;
  label: string;
  disabled?: boolean;
  requestTypes?: RequestTypeOption[];
  grants?: RequestTypeGrant[];
  onLevel: (level: AppAccessLevel) => void;
  onToggleSubView: (id: string) => void;
  onSides?: (sides: { sender: boolean; receiver: boolean }) => void;
  onToggleType?: (key: string) => void;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const selected = new Set(grants?.map((row) => row.requestType) ?? []);
  const hidden = item.level === "none";
  const shownSubViews = entry.subViews.filter((view) => item.subViews.includes(view.id)).length;

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-black/15 bg-white p-3",
        entry.rcm && "md:col-span-2",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: launcherTileHex(entry.appId) }}
        >
          {createElement(resolveIcon(iconName), { className: "size-3.5 text-white" })}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-[#18181B]">{label}</p>
          <p className="truncate text-[10.5px] text-[#71717A]">
            {hidden
              ? t("hiddenFromUser")
              : t("subViewsSummary", {
                  level: t(LEVEL_KEYS[item.level]),
                  shown: shownSubViews,
                  total: entry.subViews.length,
                })}
          </p>
        </div>
      </div>

      <div className="flex h-[30px] items-center gap-px rounded-lg bg-[#F1F3F5] p-[3px]">
        {APP_ACCESS_LEVELS.map((level) => {
          const active = item.level === level;
          return (
            <button
              key={level}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onLevel(level)}
              className={cn(
                "h-6 flex-1 cursor-pointer rounded-md text-[10px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "bg-[#18181B] font-medium text-white"
                  : "text-[#6B7280] hover:text-[#18181B]",
              )}
            >
              {t(LEVEL_KEYS[level])}
            </button>
          );
        })}
      </div>

      {item.custom ? (
        <p className="flex items-center gap-1.5 text-[9.5px] text-[#646464]">
          <span className="size-1.5 shrink-0 rounded-full bg-[#646464]" aria-hidden />
          {t("changedManually")}
        </p>
      ) : null}

      {!hidden && entry.subViews.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[#9CA3AF]">
            {t("visibleSubViews")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {entry.subViews.map((view) => (
              <SubViewChip
                key={view.id}
                active={item.subViews.includes(view.id)}
                disabled={disabled}
                onClick={() => onToggleSubView(view.id)}
                label={t(view.labelKey)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {!hidden && entry.rcm && onSides ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[#9CA3AF]">
            {t("sides")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <SubViewChip
              active={item.sender === true}
              disabled={disabled}
              onClick={() => onSides({ sender: !item.sender, receiver: item.receiver === true })}
              label={t("outgoingSender")}
            />
            <SubViewChip
              active={item.receiver === true}
              disabled={disabled}
              onClick={() => onSides({ sender: item.sender === true, receiver: !item.receiver })}
              label={t("incomingReceiver")}
            />
          </div>
        </div>
      ) : null}

      {!hidden && entry.rcm && requestTypes && onToggleType ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.6px] text-[#9CA3AF]">
            {t("requestTypes")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {requestTypes.map((type) => (
              <SubViewChip
                key={type.key}
                active={selected.has(type.key)}
                disabled={disabled}
                onClick={() => onToggleType(type.key)}
                label={type.labelEn}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function appCardMatchesQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

export function appHasAccess(item: AppAccessItem): boolean {
  return item.level !== "none";
}
