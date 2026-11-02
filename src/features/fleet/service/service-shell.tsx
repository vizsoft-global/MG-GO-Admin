"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { TabBar } from "@/components/dashboard/tab-bar";
import { ServiceRecordsShell } from "./service-records-shell";
import { ServiceReportsTab } from "./service-reports-tab";
import { ServiceMaintenanceTab } from "./service-maintenance-tab";

export type ServiceTabId = "records" | "reports" | "maintenance";

const TABS: ServiceTabId[] = ["records", "reports", "maintenance"];

function parseTab(value: string | null): ServiceTabId {
  return TABS.includes(value as ServiceTabId) ? (value as ServiceTabId) : "records";
}

export function ServiceShell({
  canManage,
  canExport,
}: {
  canManage: boolean;
  canExport: boolean;
}) {
  const t = useTranslations("pages.fleetService");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));

  function selectTab(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next === "records") query.delete("tab");
    else query.set("tab", next);
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[{ label: t("breadcrumb.title") }]}
        tabs={
          <TabBar
            items={TABS.map((id) => ({ id, label: t(`tabs.${id}`) }))}
            activeId={tab}
            onSelect={selectTab}
          />
        }
      />
      {tab === "records" ? (
        <ServiceRecordsShell canManage={canManage} canExport={canExport} />
      ) : null}
      {tab === "reports" ? <ServiceReportsTab canExport={canExport} /> : null}
      {tab === "maintenance" ? (
        <ServiceMaintenanceTab canManage={canManage} canExport={canExport} />
      ) : null}
    </AppPage>
  );
}
