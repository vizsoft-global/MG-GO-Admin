"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { ToggleChip } from "@/components/app/toggle-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchRequestTypeScreenshotPolicy,
  updateRequestTypeScreenshotPolicy,
} from "@/features/requests/requests-settings-actions";
import type { RequestTypeScreenshotPolicyRow, RequestTypeSlug } from "@/features/requests/settings-types";
import {
  useEsignCategories,
  useEsignScreenshotDefault,
  useUpdateEsignScreenshotDefault,
} from "./use-esign";
import { upsertEsignCategory } from "./esign-actions";
import type { EsignCategoryRow } from "./types";

export function EsignScreenshotSettingsShell() {
  const t = useTranslations("pages.requests.esign.screenshot");
  const tTypes = useTranslations("pages.requests.types");
  const tSettings = useTranslations("pages.requests.settings");
  const { data: defaultData, isLoading: defaultLoading } = useEsignScreenshotDefault();
  const updateDefault = useUpdateEsignScreenshotDefault();
  const { data: categories, isLoading: categoriesLoading, refetch: refetchCategories } =
    useEsignCategories();

  const [typePolicies, setTypePolicies] = useState<RequestTypeScreenshotPolicyRow[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [, startTransition] = useTransition();

  const loadTypes = useCallback(async () => {
    setTypesLoading(true);
    const result = await fetchRequestTypeScreenshotPolicy();
    setTypesLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setTypePolicies(result.rows.filter((r) => r.is_active));
  }, []);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  function toggleType(row: RequestTypeScreenshotPolicyRow) {
    setTypePolicies((prev) =>
      prev.map((r) =>
        r.request_type === row.request_type
          ? { ...r, screenshot_restricted: !r.screenshot_restricted }
          : r,
      ),
    );
    startTransition(async () => {
      const result = await updateRequestTypeScreenshotPolicy(row.request_type, {
        screenshot_restricted: !row.screenshot_restricted,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        void loadTypes();
      }
    });
  }

  function toggleCategory(row: EsignCategoryRow) {
    startTransition(async () => {
      const result = await upsertEsignCategory({
        id: row.id,
        key: row.key,
        label_en: row.label_en,
        description: row.description,
        screenshot_restricted: !row.screenshot_restricted,
        is_active: row.is_active,
        sort_order: row.sort_order,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      await refetchCategories();
    });
  }

  const toggleDefault = async () => {
    const next = !(defaultData?.value ?? true);
    const result = await updateDefault.mutateAsync(next);
    if (!result.ok) {
      toast.error(result.error ?? t("errors.saveFailed"));
      return;
    }
    toast.success(t("saved"));
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tSettings("title"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      <AppListCard className="flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-900">{t("defaultLabel")}</p>
            <p className="text-[11px] text-amber-800">{t("overrideNote")}</p>
          </div>
        </div>
        {defaultLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-amber-700" />
        ) : (
          <ToggleChip selected={defaultData?.value ?? true} onClick={() => void toggleDefault()}>
            {defaultData?.value ?? true ? t("blocked") : t("allowed")}
          </ToggleChip>
        )}
      </AppListCard>

      <AppListCard className="p-0">
        <h3 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("sectionRequestTypes")}
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colItem")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colScreenshot")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {typesLoading ? (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : (
              typePolicies.map((row) => (
                <TableRow key={row.request_type}>
                  <TableCell className="text-sm font-medium">
                    {tTypes(row.request_type as RequestTypeSlug)}
                  </TableCell>
                  <TableCell>
                    <ToggleChip selected={row.screenshot_restricted} onClick={() => toggleType(row)}>
                      {row.screenshot_restricted ? t("blocked") : t("allowed")}
                    </ToggleChip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AppListCard>

      <AppListCard className="p-0">
        <h3 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("sectionCategories")}
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colItem")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colScreenshot")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categoriesLoading ? (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : (categories?.rows ?? [])
                .filter((row) => row.is_active)
                .map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm font-medium">{row.label_en}</TableCell>
                    <TableCell>
                      <ToggleChip
                        selected={row.screenshot_restricted}
                        onClick={() => toggleCategory(row)}
                      >
                        {row.screenshot_restricted ? t("blocked") : t("allowed")}
                      </ToggleChip>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </AppListCard>
    </AppPage>
  );
}
