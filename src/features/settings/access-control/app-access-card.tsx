"use client";

import { useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";
import {
  APP_ACCESS_LEVELS,
  type AppAccessEntry,
  type AppAccessItem,
  type AppAccessLevel,
} from "@/lib/auth/app-access";
import type { RequestTypeGrant, RequestTypeOption } from "@/features/settings/staff-access-actions";
import type { EsignCategoryGrant } from "@/features/esign/esign-staff-access";
import { OUTGOING_SENDER_KEYS } from "@/features/esign/outgoing-hub-categories";
import { cn } from "@/lib/utils";
import { AccessAppIcon, AccessLevelPill } from "./access-parts";

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
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-[9px] py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-[#e4ddd9] bg-[#f8f5f3] text-[#27273f]"
          : "border-[#e4ddd9] bg-white text-[#8c8798] hover:bg-[#faf8f7]",
      )}
    >
      {active ? (
        <Check className="size-3 shrink-0 stroke-[3] text-[#27273f]" aria-hidden />
      ) : (
        <Plus className="size-3 shrink-0 stroke-[3] text-[#8c8798]" aria-hidden />
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
  esignGrants,
  onLevel,
  onToggleSubView,
  onSides,
  onToggleType,
  onToggleEsign,
}: {
  entry: AppAccessEntry;
  item: AppAccessItem;
  iconName: string;
  label: string;
  disabled?: boolean;
  requestTypes?: RequestTypeOption[];
  grants?: RequestTypeGrant[];
  esignGrants?: EsignCategoryGrant[];
  onLevel: (level: AppAccessLevel) => void;
  onToggleSubView: (id: string) => void;
  onSides?: (sides: { sender: boolean; receiver: boolean }) => void;
  onToggleType?: (key: string) => void;
  onToggleEsign?: (key: string) => void;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const selected = new Set(grants?.map((row) => row.requestType) ?? []);
  const selectedEsign = new Set(esignGrants?.map((row) => row.categoryKey) ?? []);
  const hidden = item.level === "none";
  const shownSubViews = entry.subViews.filter((view) => item.subViews.includes(view.id)).length;

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-[#e4ddd9] bg-white p-4",
        entry.rcm && "md:col-span-2",
      )}
    >
      <div className="flex items-start gap-2.5">
        <AccessAppIcon appId={entry.appId} iconName={iconName} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-[#27273f]">{label}</p>
            <AccessLevelPill level={item.level} />
          </div>
          <p className="truncate text-xs text-[#8c8798]">
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

      <div className="flex h-[34px] items-center gap-px rounded-lg bg-[#f1eeec] p-[3px]">
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
                "h-7 flex-1 cursor-pointer rounded-md text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "bg-[#27273f] font-medium text-white"
                  : "text-[#5e5e72] hover:text-[#27273f]",
              )}
            >
              {t(LEVEL_KEYS[level])}
            </button>
          );
        })}
      </div>

      {item.custom ? (
        <p className="flex items-center gap-1.5 text-xs text-[#8c8798]">
          <span className="size-1.5 shrink-0 rounded-full bg-[#8c8798]" aria-hidden />
          {t("changedManually")}
        </p>
      ) : null}

      {!hidden && entry.subViews.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-[#8c8798]">
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
          <p className="text-xs font-medium text-[#8c8798]">
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

      {!hidden && entry.rcm && item.sender === true && onToggleEsign ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-[#8c8798]">
            {t("outgoingCategoriesHeading")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {OUTGOING_SENDER_KEYS.map((key) => (
              <SubViewChip
                key={key}
                active={selectedEsign.has(key)}
                disabled={disabled}
                onClick={() => onToggleEsign(key)}
                label={t(`outgoingCategories.${key}`)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {!hidden && entry.rcm && item.receiver === true && requestTypes && onToggleType ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-[#8c8798]">
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
