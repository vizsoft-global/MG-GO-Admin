"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Package } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { fetchAssetsCatalog } from "@/features/assets/assets-actions";
import type { AssetCatalogRow } from "@/features/assets/types";

export function EsignAssetsLinkShell() {
  const t = useTranslations("pages.requests.esign.assets");
  const tSettings = useTranslations("pages.requests.settings");
  const [rows, setRows] = useState<AssetCatalogRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    fetchAssetsCatalog()
      .then((result) => setRows(result.items))
      .catch(() => setForbidden(true));
  }, []);

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tSettings("title"), href: "/requests/settings" },
          { label: t("title") },
        ]}
        actions={
          <Button type="button" size="sm" className="h-9" render={<Link href="/assets" />}>
            <ExternalLink className="me-1.5 h-3.5 w-3.5" />
            {t("openAssets")}
          </Button>
        }
      />

      {forbidden ? (
        <AppListCard className="flex flex-col items-start gap-3 p-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/30">
            <Package className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="text-sm">{t("body")}</p>
        </AppListCard>
      ) : (
        <AppListCard className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colStock")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    {t("empty")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                          <Package className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-medium">{row.name}</p>
                          <p className="text-[10px] text-muted-foreground">{row.code}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {row.is_low_stock ? (
                        <span className="text-destructive">
                          {t("lowStock", { count: row.available_qty })}
                        </span>
                      ) : (
                        t("inStock", { count: row.available_qty })
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={row.is_active ? "success" : "neutral"}>
                        {row.is_active ? t("activeOn") : t("activeOff")}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </AppListCard>
      )}
    </AppPage>
  );
}
