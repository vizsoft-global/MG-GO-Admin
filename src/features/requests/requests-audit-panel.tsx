"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import {
  fetchRequestsAuditLogs,
  type RequestsAuditLogRow,
} from "./requests-settings-actions";

export function RequestsAuditPanel() {
  const t = useTranslations("pages.requests.settings.audit");
  const [rows, setRows] = useState<RequestsAuditLogRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await fetchRequestsAuditLogs();
      if (result.error) {
        toast.error(result.error ?? t("errors.loadFailed"));
        return;
      }
      setRows(result.rows);
      setLoaded(true);
    });
  }, [t]);

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
        actions={
          <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("load")}
          </Button>
        }
      />

      <AppListCard className="p-0">
        <AppDataTable
          columns={[
            { id: "when", label: t("colWhen") },
            { id: "action", label: t("colAction") },
            { id: "route", label: t("colRoute") },
            { id: "entity", label: t("colEntity") },
          ]}
        >
          {!loaded ? (
            <AppDataTableEmpty>{t("prompt")}</AppDataTableEmpty>
          ) : rows.length === 0 ? (
            <AppDataTableEmpty>{t("empty")}</AppDataTableEmpty>
          ) : (
            rows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="text-xs whitespace-nowrap">
                  {new Date(row.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-xs">{row.action}</TableCell>
                <TableCell className="text-xs">{row.route_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-[10px]">{row.entity_id ?? "—"}</TableCell>
              </AppDataTableRow>
            ))
          )}
        </AppDataTable>
      </AppListCard>
    </AppPage>
  );
}
