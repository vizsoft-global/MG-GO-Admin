"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
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
  const tCommon = useTranslations("pages.requests.esign");
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
    <AppPage className="space-y-3">
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tCommon("hub.requests"), href: "/requests" },
          { label: tCommon("hub.title"), href: "/requests/esign" },
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
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-amber-900">
              {(defaultData?.value ?? true) ? t("blocked") : t("allowed")}
            </span>
            <Switch
              checked={!(defaultData?.value ?? true)}
              onCheckedChange={() => void toggleDefault()}
              aria-label={t("defaultLabel")}
            />
          </div>
        )}
      </AppListCard>

      {/* Figma stacks both groups in one table because the mock has 10 items. Production
          carries 15, which overflows a 14-inch viewport, so the two groups sit side by
          side instead — same columns, same grouping, no row hidden. */}
      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <AppListCard className="h-full min-w-0 p-0">
          <p className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sectionRequestTypes")}
          </p>
          <Table style={{ tableLayout: "fixed" }}>
            <TableHeader>
              <TableRow>
                <TableHead className={cn(TABLE_HEAD_CLASS, "w-[46%]")}>{t("colItem")}</TableHead>
                <TableHead className={cn(TABLE_HEAD_CLASS, "w-[34%]")}>{t("colAppliesTo")}</TableHead>
                <TableHead className={cn(TABLE_HEAD_CLASS, "w-[20%]")}>
                  {t("colScreenshot")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typesLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : (
                typePolicies.map((row) => (
                  <TableRow key={row.request_type}>
                    <TableCell className="truncate text-sm font-medium">
                      {tTypes(row.request_type as RequestTypeSlug)}
                    </TableCell>
                    <TableCell className="truncate text-xs text-muted-foreground">
                      {t(`appliesTo.${row.request_type}` as "appliesTo.leave")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!row.screenshot_restricted}
                          onCheckedChange={() => toggleType(row)}
                          aria-label={tTypes(row.request_type as RequestTypeSlug)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {row.screenshot_restricted ? t("blocked") : t("allowed")}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </AppListCard>

        <AppListCard className="h-full min-w-0 p-0">
          <p className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sectionCategories")}
          </p>
          <Table style={{ tableLayout: "fixed" }}>
            <TableHeader>
              <TableRow>
                <TableHead className={cn(TABLE_HEAD_CLASS, "w-[46%]")}>{t("colItem")}</TableHead>
                <TableHead className={cn(TABLE_HEAD_CLASS, "w-[34%]")}>{t("colAppliesTo")}</TableHead>
                <TableHead className={cn(TABLE_HEAD_CLASS, "w-[20%]")}>
                  {t("colScreenshot")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoriesLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : (
                (categories?.rows ?? [])
                  .filter((row) => row.is_active)
                  .map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="truncate text-sm font-medium" title={row.label_en}>{row.label_en}</TableCell>
                      <TableCell className="truncate text-xs text-muted-foreground">
                        {row.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={!row.screenshot_restricted}
                            onCheckedChange={() => toggleCategory(row)}
                            aria-label={row.label_en}
                          />
                          <span className="text-xs text-muted-foreground">
                            {row.screenshot_restricted ? t("blocked") : t("allowed")}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </AppListCard>
      </div>
    </AppPage>
  );
}
