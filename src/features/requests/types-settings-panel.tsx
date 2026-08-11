"use client";

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { REQUEST_TYPE_SLUGS } from "./settings-types";

export function TypesSettingsPanel() {
  const t = useTranslations("pages.requests.settings.types");
  const tTypes = useTranslations("pages.requests.types");

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      <AppListCard className="space-y-3 p-4">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{t("deferredNote")}</p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colSlug")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabel")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {REQUEST_TYPE_SLUGS.map((slug) => (
              <TableRow key={slug}>
                <TableCell className="font-mono text-xs">{slug}</TableCell>
                <TableCell>{tTypes(slug)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{t("builtIn")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AppListCard>
    </AppPage>
  );
}
