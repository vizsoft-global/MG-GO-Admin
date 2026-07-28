"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppReleaseAdoption } from "./use-app-releases";
import type { AppReleaseAdoptionRow, AppReleaseChannel } from "./types";
import { AppReleasesDriversSheet } from "./app-releases-drivers-sheet";

export function AppReleasesAdoptionPanel({ channel }: { channel: AppReleaseChannel }) {
  const t = useTranslations("pages.appReleases.adoption");
  const { data, isLoading, error } = useAppReleaseAdoption(channel);
  const [selected, setSelected] = useState<AppReleaseAdoptionRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openDrivers = (row: AppReleaseAdoptionRow) => {
    setSelected(row);
    setSheetOpen(true);
  };

  return (
    <>
      <AppListCard title={t("title")} description={t("description")}>
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <AppEmptyState title={t("errorTitle")} description={String(error.message)} />
        ) : !data || data.items.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("summary", {
                total: data.total_drivers,
                active: data.active_version_code ?? t("noneActive"),
              })}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.version")}</TableHead>
                  <TableHead>{t("columns.drivers")}</TableHead>
                  <TableHead>{t("columns.percent")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => {
                  const key =
                    row.version_code == null ? "unknown" : String(row.version_code);
                  const label =
                    row.version_code == null
                      ? t("unknownVersion")
                      : `${row.version_name} (${row.version_code})`;
                  return (
                    <TableRow
                      key={key}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => openDrivers(row)}
                    >
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell>{row.driver_count}</TableCell>
                      <TableCell>{row.percent}%</TableCell>
                      <TableCell className="space-x-2">
                        {row.is_active ? <Badge>{t("activeRelease")}</Badge> : null}
                        {!row.is_known_release && row.version_code != null ? (
                          <Badge variant="outline">{t("unknownRelease")}</Badge>
                        ) : null}
                        {row.version_code == null ? (
                          <Badge variant="secondary">{t("neverReported")}</Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </AppListCard>

      <AppReleasesDriversSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        channel={channel}
        row={selected}
      />
    </>
  );
}
