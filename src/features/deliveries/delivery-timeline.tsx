"use client";

import { useLocale, useTranslations } from "next-intl";
import { MapPin, Package, ShieldCheck, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { type CancelReasonCode, parseCancelReason } from "./parse-cancel-reason";
import type { DeliveryListRow } from "./types";

type Step = {
  key: string;
  label: string;
  at: string | null;
  detail?: string | null;
  state: "done" | "pending" | "muted";
  icon: typeof Package;
};

function cancelTimelineDetail(
  raw: string | null,
  labelFor: (code: CancelReasonCode) => string,
): string | null {
  const parsed = parseCancelReason(raw);
  if (!parsed) return null;
  const label = labelFor(parsed.code);
  return parsed.note ? `${label} — ${parsed.note}` : label;
}

function formatAt(value: string | null, locale: string): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-KW" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(at);
}

/**
 * One canonical five-step model for admin and rider. A null integrity field is
 * "not checked", never "clean": rows completed before this pass carry no verdict.
 */
export function DeliveryTimeline({ delivery }: { delivery: DeliveryListRow }) {
  const t = useTranslations("pages.deliveries.timeline");
  const tDelivery = useTranslations("pages.deliveries");
  const locale = useLocale();

  const earlyDrop = delivery.is_early_drop === true;
  const outsideZone = delivery.is_out_of_zone === true;
  const mismatch = delivery.order_proof_ocr_matched === false;
  const checksKnown =
    delivery.is_early_drop !== null ||
    delivery.is_out_of_zone !== null ||
    delivery.order_proof_ocr_matched !== null;

  const checkLabels: string[] = [];
  if (earlyDrop) checkLabels.push(t("earlyDrop"));
  if (outsideZone) checkLabels.push(t("outsideZone"));
  if (mismatch) checkLabels.push(t("photoMismatch"));
  const checkDetail = !checksKnown
    ? t("notChecked")
    : checkLabels.length > 0
      ? checkLabels.join(" · ")
      : t("checksClean");

  const terminal =
    delivery.status === "verified"
      ? t("verified")
      : delivery.status === "rejected"
        ? t("rejected")
        : delivery.status === "under_review"
          ? t("underReview")
          : delivery.status === "pending"
            ? t("awaitingReview")
            : delivery.status === "cancelled"
              ? t("cancelled")
              : t("awaitingReview");

  const steps: Step[] = [
    {
      key: "created",
      label: t("created"),
      at: formatAt(delivery.created_at, locale),
      state: "done",
      icon: Package,
    },
    {
      key: "pickup",
      label: t("pickedUp"),
      at: formatAt(delivery.pickup_at, locale),
      state: delivery.pickup_at ? "done" : "pending",
      icon: Truck,
    },
    {
      key: "delivered",
      label: delivery.status === "cancelled" ? t("cancelled") : t("delivered"),
      at: formatAt(
        delivery.status === "cancelled" ? delivery.cancelled_at : delivery.delivered_at,
        locale,
      ),
      detail:
        delivery.status === "cancelled"
          ? cancelTimelineDetail(delivery.cancel_reason, (code) => {
              switch (code) {
                case "item_unavailable":
                  return tDelivery("cancelReason.item_unavailable");
                case "restaurant_canceled":
                  return tDelivery("cancelReason.restaurant_canceled");
                case "long_preparation":
                  return tDelivery("cancelReason.long_preparation");
                case "highway_order":
                  return tDelivery("cancelReason.highway_order");
                case "auto_accept_unconfirmed":
                  return tDelivery("cancelReason.auto_accept_unconfirmed");
                case "customer_canceled":
                  return tDelivery("cancelReason.customer_canceled");
                case "food_theft":
                  return tDelivery("cancelReason.food_theft");
                case "navigation_issue":
                  return tDelivery("cancelReason.navigation_issue");
                case "delivery_delayed":
                  return tDelivery("cancelReason.delivery_delayed");
                case "food_too_large":
                  return tDelivery("cancelReason.food_too_large");
                case "merchant_closed":
                  return tDelivery("cancelReason.merchant_closed");
                case "order_reassigned":
                  return tDelivery("cancelReason.order_reassigned");
                case "accident":
                  return tDelivery("cancelReason.accident");
                case "wrong_address":
                  return tDelivery("cancelReason.wrong_address");
                case "vehicle_breakdown":
                  return tDelivery("cancelReason.vehicle_breakdown");
                case "customer_no_show":
                  return tDelivery("cancelReason.customer_no_show");
                case "customer_refused":
                  return tDelivery("cancelReason.customer_refused");
                case "restaurant_issue":
                  return tDelivery("cancelReason.restaurant_issue");
                case "other":
                  return tDelivery("cancelReason.other");
                default: {
                  const exhaustive: never = code;
                  return exhaustive;
                }
              }
            })
          : null,
      state:
        delivery.status === "cancelled"
          ? delivery.cancelled_at
            ? "done"
            : "pending"
          : delivery.delivered_at
            ? "done"
            : "pending",
      icon: MapPin,
    },
    {
      key: "checks",
      label: t("checks"),
      at: null,
      detail: checkDetail,
      state: checksKnown ? "done" : "muted",
      icon: ShieldCheck,
    },
    {
      key: "review",
      label: t("review"),
      at: null,
      detail: terminal,
      state:
        delivery.status === "verified"
          ? "done"
          : delivery.status === "rejected"
            ? "done"
            : delivery.status === "under_review"
              ? "done"
              : "pending",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="shrink-0 border-b border-border px-4 py-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className={cn(
                "min-h-0 rounded-lg border p-2.5",
                step.state === "done" && "border-emerald-200 bg-emerald-50/40",
                step.state === "pending" && "border-border bg-card",
                step.state === "muted" && "border-dashed border-border bg-muted/20",
              )}
              title={step.detail ?? undefined}
            >
              <div className="flex items-center gap-1.5">
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    step.state === "done" ? "text-emerald-700" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {step.label}
                </p>
              </div>
              <p className="mt-1 truncate text-xs font-medium text-foreground">
                {step.at ?? step.detail ?? "—"}
              </p>
              {step.at && step.detail ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{step.detail}</p>
              ) : null}
            </div>
          );
        })}
      </div>
      {earlyDrop || outsideZone || mismatch ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {earlyDrop ? (
            <span
              className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800"
              title={
                delivery.pickup_delivery_distance_m !== null
                  ? t("distanceMeters", {
                      meters: Math.round(delivery.pickup_delivery_distance_m),
                    })
                  : undefined
              }
            >
              {t("earlyDrop")}
            </span>
          ) : null}
          {outsideZone ? (
            <span
              className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700"
              title={
                delivery.zone_distance_m !== null
                  ? t("distanceMeters", { meters: Math.round(delivery.zone_distance_m) })
                  : undefined
              }
            >
              {t("outsideZone")}
            </span>
          ) : null}
          {mismatch ? (
            <span
              className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700"
              title={delivery.order_proof_ocr_order_id ?? undefined}
            >
              {t("photoMismatch")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
