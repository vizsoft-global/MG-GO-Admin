"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { buildCsv, downloadCsv } from "@/features/driver-tracking/csv-export";
import { fetchAdminRequestsList } from "@/features/requests/requests-actions";
import { fetchEsignRequestsList } from "./esign-actions";

export function EsignImportExportShell() {
  const t = useTranslations("pages.requests.esign.importExport");
  const [exportingEsign, setExportingEsign] = useState(false);
  const [exportingRequests, setExportingRequests] = useState(false);

  const exportEsignCsv = async () => {
    setExportingEsign(true);
    const result = await fetchEsignRequestsList({ limit: 500 });
    setExportingEsign(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.rows.length === 0) {
      toast.error(t("exportEmpty"));
      return;
    }
    const csv = buildCsv(
      [
        "request_code",
        "title",
        "driver_name",
        "driver_code",
        "category",
        "status",
        "due_at",
        "signed_at",
        "created_at",
      ],
      result.rows.map((r) => [
        r.request_code,
        r.title,
        r.driver_name,
        r.driver_code,
        r.category_label ?? "",
        r.status,
        r.due_at ?? "",
        r.signed_at ?? "",
        r.created_at,
      ]),
    );
    downloadCsv(`esign-requests-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(t("exportOk", { count: result.rows.length }));
  };

  const exportRequestsCsv = async () => {
    setExportingRequests(true);
    const result = await fetchAdminRequestsList({ datePreset: "all", limit: 1000, offset: 0 });
    setExportingRequests(false);
    if (result.rows.length === 0) {
      toast.error(t("exportEmpty"));
      return;
    }
    const csv = buildCsv(
      ["request_code", "type", "status", "driver_name", "driver_code", "created_at"],
      result.rows.map((r) => [
        r.request_code,
        r.request_type,
        r.status,
        r.driver_name,
        r.driver_code,
        r.created_at,
      ]),
    );
    downloadCsv(`rcm-requests-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(t("exportOk", { count: result.rows.length }));
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("requests"), href: "/requests" },
          { label: t("title") },
        ]}
      />

      <div className="grid gap-2 lg:grid-cols-2">
        <AppListCard className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">{t("exportRequestsTitle")}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("exportRequestsBody")}</p>
          <Button
            type="button"
            className="h-9"
            disabled={exportingRequests}
            onClick={() => void exportRequestsCsv()}
          >
            {exportingRequests ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {t("exportButton")}
          </Button>
        </AppListCard>

        <AppListCard className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">{t("exportTitle")}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("exportBody")}</p>
          <Button
            type="button"
            className="h-9"
            disabled={exportingEsign}
            onClick={() => void exportEsignCsv()}
          >
            {exportingEsign ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {t("exportButton")}
          </Button>
        </AppListCard>

        <AppListCard className="space-y-3 p-4 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">{t("importTitle")}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("importBody")}</p>
          <Button type="button" variant="outline" className="h-9" disabled>
            {t("importComingSoon")}
          </Button>
        </AppListCard>
      </div>
    </AppPage>
  );
}
