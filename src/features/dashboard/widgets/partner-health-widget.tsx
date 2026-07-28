"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PartnerHealthCard } from "../types";
import {
  DASHBOARD_WIDGET_PREVIEW_LIMIT,
  DashboardWidget,
  DashboardWidgetEmpty,
} from "./dashboard-widget";

export function PartnerHealthWidget({
  cards,
  locale,
}: {
  cards: PartnerHealthCard[];
  locale: string;
}) {
  const t = useTranslations("pages.dashboard");

  const renderCard = (card: PartnerHealthCard) => (
    <div
      key={card.partnerId}
      className="rounded-xl border border-border bg-card p-3 shadow-[0_1px_2px_rgba(15,15,15,0.04)]"
    >
      <p className="text-sm font-semibold text-foreground">{card.partnerName}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-muted/30 px-2 py-1.5">
          <p className="text-[10px] text-muted-foreground">{t("partnerAssigned")}</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {card.assignedRiders}
          </p>
        </div>
        <div className="rounded-lg bg-muted/30 px-2 py-1.5">
          <p className="text-[10px] text-muted-foreground">{t("partnerActiveToday")}</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {card.activeToday}
          </p>
        </div>
        <div className="rounded-lg bg-muted/30 px-2 py-1.5">
          <p className="text-[10px] text-muted-foreground">{t("partnerMissingAttendance")}</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {card.missingAttendance}
          </p>
        </div>
        <div className="rounded-lg bg-muted/30 px-2 py-1.5">
          <p className="text-[10px] text-muted-foreground">
            {t("partnerPendingVerification")}
          </p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {card.pendingVerification}
          </p>
        </div>
      </div>
      {card.restaurants.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border pt-2">
          {card.restaurants.slice(0, 3).map((r) => (
            <li
              key={`${card.partnerId}-${r.restaurantName}`}
              className="flex items-center justify-between text-[11px] text-muted-foreground"
            >
              <span>{r.restaurantName}</span>
              <span className="tabular-nums">
                {r.riderCount} {t("riders")}
                {r.understaffed ? ` · ${t("understaffed")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const preview = cards.slice(0, DASHBOARD_WIDGET_PREVIEW_LIMIT);
  const hasMore = cards.length > preview.length;

  return (
    <DashboardWidget
      title={t("widgetPartnerHealth")}
      href={hasMore ? undefined : `/${locale}/partners`}
      viewAllLabel={t("viewAll")}
      icon={Building2}
      tone="primary"
      badge={cards.length > 0 ? cards.length : undefined}
      modalContent={
        hasMore ? <div className="space-y-3 p-4">{cards.map(renderCard)}</div> : undefined
      }
      modalTitle={t("widgetPartnerHealth")}
    >
      {cards.length === 0 ? (
        <DashboardWidgetEmpty icon={Building2} title={t("empty")} tone="neutral" />
      ) : (
        <div className="space-y-3 p-4">{preview.map(renderCard)}</div>
      )}
    </DashboardWidget>
  );
}
