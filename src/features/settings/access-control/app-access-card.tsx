"use client";

import { createElement } from "react";
import { useTranslations } from "next-intl";
import { SegmentOption, ToggleChip } from "@/components/app/toggle-chip";
import {
  APP_ACCESS_LEVELS,
  type AppAccessEntry,
  type AppAccessItem,
  type AppAccessLevel,
} from "@/lib/auth/app-access";
import { moduleTint } from "@/lib/menu/module-colors";
import { resolveIcon } from "@/lib/menu/menu-registry";
import type { RequestTypeGrant, RequestTypeOption } from "@/features/settings/staff-access-actions";

const LEVEL_KEYS: Record<AppAccessLevel, string> = {
  none: "levelNone",
  viewer: "levelViewer",
  user: "levelUser",
  manager: "levelManager",
};

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
  const tint = moduleTint(entry.appId);
  const selected = new Set(grants?.map((row) => row.requestType) ?? []);

  return (
    <article className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: tint.chip, color: tint.ink }}
          >
            {createElement(resolveIcon(iconName), { className: "size-4" })}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{label}</p>
            {item.custom ? (
              <p className="text-[10px] font-medium text-amber-700">{t("custom")}</p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {APP_ACCESS_LEVELS.map((level) => (
          <SegmentOption
            key={level}
            selected={item.level === level}
            onClick={() => onLevel(level)}
            disabled={disabled}
            variant={level === "manager" || level === "user" ? "success" : "default"}
          >
            {t(LEVEL_KEYS[level])}
          </SegmentOption>
        ))}
      </div>
      {entry.subViews.length > 0 && item.level !== "none" ? (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("visibleSubViews")}
          </p>
          <div className="flex flex-wrap gap-1">
            {entry.subViews.map((view) => (
              <ToggleChip
                key={view.id}
                selected={item.subViews.includes(view.id)}
                onClick={() => onToggleSubView(view.id)}
                disabled={disabled}
              >
                {t(view.labelKey)}
              </ToggleChip>
            ))}
          </div>
        </div>
      ) : null}
      {entry.rcm && item.level !== "none" && onSides ? (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sides")}
          </p>
          <div className="flex flex-wrap gap-1">
            <ToggleChip
              selected={item.sender === true}
              onClick={() => onSides({ sender: !item.sender, receiver: item.receiver === true })}
              disabled={disabled}
            >
              {t("outgoingSender")}
            </ToggleChip>
            <ToggleChip
              selected={item.receiver === true}
              onClick={() => onSides({ sender: item.sender === true, receiver: !item.receiver })}
              disabled={disabled}
            >
              {t("incomingReceiver")}
            </ToggleChip>
          </div>
        </div>
      ) : null}
      {entry.rcm && item.level !== "none" && requestTypes && onToggleType ? (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("requestTypes")}
          </p>
          <div className="flex flex-wrap gap-1">
            {requestTypes.map((type) => (
              <ToggleChip
                key={type.key}
                selected={selected.has(type.key)}
                onClick={() => onToggleType(type.key)}
                disabled={disabled}
              >
                {type.labelEn}
              </ToggleChip>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function appCardMatchesQuery(
  label: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

export function appHasAccess(item: AppAccessItem): boolean {
  return item.level !== "none";
}
