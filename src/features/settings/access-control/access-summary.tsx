"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccessAppIcon, AccessAvatar, AccessLevelPill } from "./access-parts";
import {
  ACCESS_BTN_PRIMARY,
  ACCESS_BTN_SECONDARY,
  ACCESS_CARD,
  ACCESS_CHIP_BG,
  ACCESS_LEVEL_PILL,
} from "./access-ui";
import type { AppAccessLevel } from "@/lib/auth/app-access";

export type SummaryApp = {
  id: string;
  label: string;
  iconName: string;
  level: AppAccessLevel;
  subViews: { id: string; label: string }[];
  subViewsTotal: number;
  hiddenSubViews: string[];
};

export type SummaryStats = {
  apps: number;
  appsTotal: number;
  subViews: number;
  subViewsTotal: number;
  asManager: number;
  hiddenSubViews: number;
};

/** `Person Header` (7103:29803) — avatar, name + tag, meta line, two buttons. */
function PersonHeader({
  id,
  name,
  tag,
  meta,
  historyHref,
  onEditAccess,
}: {
  id: string;
  name: string;
  tag: string | null;
  meta: string;
  historyHref: string;
  onEditAccess: () => void;
}) {
  const t = useTranslations("pages.settings.accessControl");
  return (
    <div className="flex flex-wrap items-center gap-4">
      <AccessAvatar id={id} name={name} size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-xl font-bold leading-7 text-[#27273f]">{name}</h2>
          {tag ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#eeebef] py-[3px] ps-2 pe-2.5 text-xs font-medium text-[#6e6a7c]">
              <span className="size-1.5 rounded-full bg-[#6e6a7c]" aria-hidden />
              {tag}
            </span>
          ) : null}
        </div>
        <p className="truncate text-[13px] leading-[18px] text-[#5e5e72]">{meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Link href={historyHref} className={ACCESS_BTN_SECONDARY}>
          {t("viewHistory")}
        </Link>
        <button type="button" onClick={onEditAccess} className={ACCESS_BTN_PRIMARY}>
          {t("editAccess")}
        </button>
      </div>
    </div>
  );
}

function StatBar({ ratio, tint }: { ratio: number; tint: string }) {
  return (
    <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-[#f1eeec]">
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, backgroundColor: tint }}
      />
    </span>
  );
}

function StatCell({
  label,
  value,
  suffix,
  ratio,
  tint,
}: {
  label: string;
  value: number;
  suffix: string;
  ratio?: number;
  tint?: string;
}) {
  return (
    <div className="flex flex-col px-5 py-4">
      <p className="text-xs leading-4 text-[#5e5e72]">{label}</p>
      <p className="mt-1.5 text-2xl font-bold leading-[30px] text-[#27273f]">
        {value}
        <span className="ms-1 text-xs font-medium text-[#8c8798]">{suffix}</span>
      </p>
      {ratio != null && tint ? <StatBar ratio={ratio} tint={tint} /> : null}
    </div>
  );
}


/** `App Tile` (7103:29848) — icon, label and level pill, 130px wide in the frame. */
function AppTile({ app, onOpen }: { app: SummaryApp; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-[#e4ddd9] bg-white px-3 py-3.5 transition-colors duration-150 hover:border-[#c9c6d6] hover:bg-[#faf8f7]"
    >
      <AccessAppIcon appId={app.id} iconName={app.iconName} size={40} />
      <span className="max-w-full truncate text-center text-xs font-semibold leading-4 text-[#27273f]">
        {app.label}
      </span>
      <AccessLevelPill level={app.level} />
    </button>
  );
}

/** `App Row · …` (7103:29972) — the "Inside each app" row. */
function AppRow({ app, onOpen }: { app: SummaryApp; onOpen: () => void }) {
  const t = useTranslations("pages.settings.accessControl");
  return (
    <div className="flex gap-3.5 border-b border-[#e4ddd9] py-3.5 last:border-b-0">
      <AccessAppIcon appId={app.id} iconName={app.iconName} size={32} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="cursor-pointer text-sm font-semibold leading-5 text-[#27273f] transition-colors duration-150 hover:text-[#a73c24]"
          >
            {app.label}
          </button>
          <AccessLevelPill level={app.level} />
          <span className="ms-auto text-xs leading-4 text-[#8c8798]">
            {t("subViewsOfCount", { shown: app.subViews.length, total: app.subViewsTotal })}
          </span>
        </div>
        {app.subViews.length > 0 ? (
          <div className="flex flex-wrap items-start gap-1.5">
            {app.subViews.map((view) => (
              <span
                key={view.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#e4ddd9] px-[9px] py-1 text-xs font-medium text-[#27273f]"
                style={{ backgroundColor: ACCESS_CHIP_BG }}
              >
                <Check className="size-3 shrink-0 stroke-[3] text-[#27273f]" aria-hidden />
                {view.label}
              </span>
            ))}
          </div>
        ) : null}
        {app.hiddenSubViews.length > 0 ? (
          <p className="text-xs leading-4 text-[#8c8798]">
            {t("hiddenPrefix", { list: app.hiddenSubViews.join(", ") })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function NoAccessPill({ app }: { app: SummaryApp }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-lg border border-[#e4ddd9] px-2.5 py-1.5 text-xs font-medium text-[#27273f]"
      style={{ backgroundColor: ACCESS_CHIP_BG }}
    >
      <AccessAppIcon appId={app.id} iconName={app.iconName} size={22} />
      {app.label}
    </span>
  );
}

/**
 * `Access Summary` (7103:29802) — the read-only pane the overview frame shows:
 * person header, the four strip figures, the tiles the person can open, the
 * sub-views inside each one and the apps they cannot reach.
 */
export function AccessSummary({
  id,
  name,
  tag,
  meta,
  stats,
  openApps,
  noAccessApps,
  historyHref,
  onEditAccess,
  onOpenApp,
}: {
  id: string;
  name: string;
  tag: string | null;
  meta: string;
  stats: SummaryStats;
  openApps: SummaryApp[];
  noAccessApps: SummaryApp[];
  historyHref: string;
  onEditAccess: () => void;
  onOpenApp: () => void;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const userTint = ACCESS_LEVEL_PILL.user.fg;

  return (
    <section className={cn(ACCESS_CARD, "flex min-h-0 flex-col gap-5 p-5")}>
      <PersonHeader
        id={id}
        name={name}
        tag={tag}
        meta={meta}
        historyHref={historyHref}
        onEditAccess={onEditAccess}
      />

      <div className="grid divide-x divide-[#e4ddd9] overflow-hidden rounded-[10px] border border-[#e4ddd9] sm:grid-cols-2 xl:grid-cols-4">
        <StatCell
          label={t("statApps")}
          value={stats.apps}
          suffix={`/ ${stats.appsTotal}`}
          ratio={stats.appsTotal === 0 ? 0 : stats.apps / stats.appsTotal}
          tint={ACCESS_LEVEL_PILL.manager.fg}
        />
        <StatCell
          label={t("statSubViews")}
          value={stats.subViews}
          suffix={`/ ${stats.subViewsTotal}`}
          ratio={stats.subViewsTotal === 0 ? 0 : stats.subViews / stats.subViewsTotal}
          tint={userTint}
        />
        <StatCell label={t("statAsManager")} value={stats.asManager} suffix={t("appsUnit")} />
        <StatCell
          label={t("statHiddenSubViews")}
          value={stats.hiddenSubViews}
          suffix={t("subViewsUnit")}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold leading-5 text-[#27273f]">
            {t("appsCanOpen", { name })}
          </h3>
          <p className="text-xs leading-4 text-[#8c8798]">
            {t("appsCanOpenHint", { shown: openApps.length, total: stats.appsTotal })}
          </p>
        </div>
        {openApps.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#e4ddd9] px-4 py-6 text-center text-xs text-[#8c8798]">
            {t("previewEmpty")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {openApps.map((app) => (
              <AppTile key={app.id} app={app} onOpen={onOpenApp} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col">
        <div className="flex flex-wrap items-baseline gap-2 pb-1">
          <h3 className="text-sm font-semibold leading-5 text-[#27273f]">{t("insideEachApp")}</h3>
          <p className="text-xs leading-4 text-[#8c8798]">{t("insideEachAppHint")}</p>
        </div>
        {openApps.map((app) => (
          <AppRow key={app.id} app={app} onOpen={onOpenApp} />
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-[#e4ddd9] pt-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold leading-5 text-[#27273f]">{t("noAccessTitle")}</h3>
          <p className="text-xs leading-4 text-[#8c8798]">
            {t("noAccessHint", { count: noAccessApps.length })}
          </p>
        </div>
        {noAccessApps.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {noAccessApps.map((app) => (
              <NoAccessPill key={app.id} app={app} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
