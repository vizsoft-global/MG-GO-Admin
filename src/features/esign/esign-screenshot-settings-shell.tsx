"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { Link } from "@/i18n/navigation";
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

function shotWidth(id: string): string {
  if (id === "item") return "w-[46%]";
  if (id === "applies") return "w-[34%]";
  return "w-[20%]";
}
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

export type EsignScreenshotSettingsVariant = "screenshot" | "settings";

export function EsignScreenshotSettingsShell({
  variant = "screenshot",
}: {
  variant?: EsignScreenshotSettingsVariant;
}) {
  const t = useTranslations("pages.requests.esign.screenshot");
  const tSettings = useTranslations("pages.requests.esign.settings");
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

  let title: string;
  let subtitle: string;
  switch (variant) {
    case "settings":
      title = tSettings("title");
      subtitle = tSettings("subtitle");
      break;
    case "screenshot":
      title = t("title");
      subtitle = t("subtitle");
      break;
    default: {
      const _exhaustive: never = variant;
      throw new Error(`Unhandled screenshot settings variant: ${_exhaustive}`);
    }
  }

  const shotColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "item", label: t("colItem"), locked: true },
      { id: "applies", label: t("colAppliesTo") },
      { id: "shot", label: t("colScreenshot") },
    ],
    [t],
  );
  const typePrefs = useTablePrefs("esign.screenshot.types", shotColumns);
  const categoryPrefs = useTablePrefs("esign.screenshot.categories", shotColumns);
  const shownTypes = typePrefs.orderedColumns.filter((column) => typePrefs.isVisible(column.id));
  const shownCategories = categoryPrefs.orderedColumns.filter((column) =>
    categoryPrefs.isVisible(column.id),
  );
  const typeQuery = typePrefs.appliedQuery.trim().toLowerCase();
  const filteredTypes = typePolicies.filter((row) => {
    if (!typeQuery) return true;
    const item = tTypes(row.request_type as RequestTypeSlug).toLowerCase();
    const applies = t(`appliesTo.${row.request_type}` as "appliesTo.leave").toLowerCase();
    return item.includes(typeQuery) || applies.includes(typeQuery);
  });
  const categoryQuery = categoryPrefs.appliedQuery.trim().toLowerCase();
  const filteredCategories = (categories?.rows ?? [])
    .filter((row) => row.is_active)
    .filter((row) => {
      if (!categoryQuery) return true;
      return (
        row.label_en.toLowerCase().includes(categoryQuery) ||
        (row.description ?? "").toLowerCase().includes(categoryQuery)
      );
    });

  return (
    <AppPage className="space-y-3">
      <AppPageHeader
        title={title}
        description={subtitle}
        breadcrumbs={[
          { label: tCommon("hub.requests"), href: "/requests" },
          { label: tCommon("hub.title"), href: "/requests/esign" },
          { label: title },
        ]}
        actions={
          variant === "settings" ? (
            <Link
              href="/requests/esign/categories"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/10"
            >
              <ExternalLink className="h-4 w-4" />
              {tSettings("manageCategories")}
            </Link>
          ) : null
        }
      />

      <AppListCard className="flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-900">{t("defaultLabel")}</p>
            <p className="text-xs text-amber-800">{t("overrideNote")}</p>
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
          <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sectionRequestTypes")}
          </p>
          <TableToolbar
            prefs={typePrefs}
            entity={t("sectionRequestTypes")}
            columns={shotColumns}
            rowKind="dynamic"
            filteredCount={filteredTypes.length}
            totalCount={typePolicies.length}
          />
          <Table style={{ tableLayout: "fixed" }}>
            <TableHeader>
              <TableRow>
                {shownTypes.map((column) => (
                  <TableHead key={column.id} className={cn(TABLE_HEAD_CLASS, shotWidth(column.id))}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {typesLoading ? (
                <TableRow>
                  <TableCell colSpan={shownTypes.length} className="py-6 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : (
                filteredTypes.map((row) => {
                  const label = tTypes(row.request_type as RequestTypeSlug);
                  const cells: Record<string, ReactNode> = {
                    item: <TableNameCell name={label} />,
                    applies: t(`appliesTo.${row.request_type}` as "appliesTo.leave") || <EmptyCell />,
                    shot: (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!row.screenshot_restricted}
                          onCheckedChange={() => toggleType(row)}
                          aria-label={label}
                        />
                        <span className="text-xs text-muted-foreground">
                          {row.screenshot_restricted ? t("blocked") : t("allowed")}
                        </span>
                      </div>
                    ),
                  };
                  return (
                    <TableRow key={row.request_type}>
                      {shownTypes.map((column) => (
                        <TableCell key={column.id} className="truncate text-sm">
                          {cells[column.id]}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </AppListCard>

        <AppListCard className="h-full min-w-0 p-0">
          <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sectionCategories")}
          </p>
          <TableToolbar
            prefs={categoryPrefs}
            entity={t("sectionCategories")}
            columns={shotColumns}
            rowKind="dynamic"
            filteredCount={filteredCategories.length}
            totalCount={(categories?.rows ?? []).filter((row) => row.is_active).length}
          />
          <Table style={{ tableLayout: "fixed" }}>
            <TableHeader>
              <TableRow>
                {shownCategories.map((column) => (
                  <TableHead key={column.id} className={cn(TABLE_HEAD_CLASS, shotWidth(column.id))}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoriesLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={shownCategories.length}
                    className="py-6 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : (
                filteredCategories.map((row) => {
                  const cells: Record<string, ReactNode> = {
                    item: <TableNameCell name={row.label_en} />,
                    applies: row.description || <EmptyCell />,
                    shot: (
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
                    ),
                  };
                  return (
                    <TableRow key={row.id}>
                      {shownCategories.map((column) => (
                        <TableCell key={column.id} className="truncate text-sm">
                          {cells[column.id]}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </AppListCard>
      </div>
    </AppPage>
  );
}
