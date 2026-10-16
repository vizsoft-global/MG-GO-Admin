"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fuel, ReceiptText, Undo2 } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { useFleetBreadcrumbs } from "@/features/fleet/use-fleet-breadcrumbs";
import { TabBar } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { useRouter } from "@/i18n/navigation";
import { FleetRequestPageShell } from "./fleet-request-page-shell";
import { FuelPageShell } from "./fuel-page-shell";

const FUEL_TABS = ["log", "request", "refund"] as const;
type FuelHubTab = (typeof FUEL_TABS)[number];

function parseFuelTab(value: string | null): FuelHubTab | null {
  return FUEL_TABS.includes(value as FuelHubTab) ? (value as FuelHubTab) : null;
}

export function FuelHubShell({ initialAnchor }: { initialAnchor: string }) {
  const t = useTranslations("pages.fuel");
  const withHub = useFleetBreadcrumbs();
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const allowed = useMemo(() => {
    const tabs: FuelHubTab[] = [];
    if (can("fuel.view")) tabs.push("log");
    if (can("fuel.view") || can("fuel_requests.view")) tabs.push("request");
    if (can("fuel.view") || can("fuel_refunds.view")) tabs.push("refund");
    return tabs;
  }, [can]);
  const requested = parseFuelTab(searchParams.get("tab"));
  const tab = requested && allowed.includes(requested) ? requested : (allowed[0] ?? "log");

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={withHub({ label: t("title") })}
        title={t("title")}
        description={t("subtitle")}
        actions={tab === "log" ? <ClearAllModuleButton entity="fuel" /> : undefined}
      />
      {allowed.length > 0 ? (
        <TabBar
          items={allowed.map((id) => ({
            id,
            label: id === "log" ? t("tabLog") : id === "request" ? t("tabRequest") : t("tabRefund"),
            icon: id === "log" ? Fuel : id === "request" ? ReceiptText : Undo2,
          }))}
          activeId={tab}
          onSelect={(id) => router.replace(`/fuel?tab=${id}`)}
        />
      ) : null}
      {tab === "log" ? <FuelPageShell initialAnchor={initialAnchor} embedded /> : null}
      {tab === "request" ? <FleetRequestPageShell type="fuel" embedded /> : null}
      {tab === "refund" ? <FleetRequestPageShell type="fuel_refund" embedded /> : null}
    </AppPage>
  );
}
