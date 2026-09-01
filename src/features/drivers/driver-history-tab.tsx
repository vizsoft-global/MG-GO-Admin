"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  ChevronDown,
  CircleDot,
  FileText,
  ListFilter,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Upload,
  UserPlus,
} from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query/query-keys";
import {
  listDriverChangeEvents,
  type DriverChangeEventRow,
} from "./driver-change-log-actions";
import {
  DRIVER_CHANGE_SOURCES,
  type DriverChangeSource,
} from "./driver-change-log-shared";

const KUWAIT_TZ = "Asia/Kuwait";

const FILTERS = [
  "all",
  "manual_create",
  "bulk_import",
  "edit",
  "assignment",
  "approve",
  "status",
  "document",
  "asset",
] as const;

const FILTER_ICONS: Record<(typeof FILTERS)[number], LucideIcon> = {
  all: ListFilter,
  manual_create: UserPlus,
  bulk_import: Upload,
  edit: Pencil,
  approve: BadgeCheck,
  status: CircleDot,
  document: FileText,
  asset: Package,
  assignment: MapPin,
};

const KNOWN_FIELDS = new Set([
  "full_name",
  "phone",
  "civil_id",
  "employee_id",
  "driver_code",
  "partner",
  "zone",
  "restaurants",
  "vehicle",
  "nationality",
  "rider_category",
  "client_id",
  "client_name",
  "workflow_status",
  "account_status",
  "blocked",
  "block_reason",
]);

function formatWhen(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: KUWAIT_TZ,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fieldLabel(
  field: string,
  t: ReturnType<typeof useTranslations<"pages.driverDetail.history">>,
): string {
  if (KNOWN_FIELDS.has(field)) return t(`fields.${field}` as "fields.phone");
  if (field.startsWith("custom.")) return field.slice(7);
  if (field.startsWith("asset.")) return field.slice(6);
  if (field.startsWith("document.")) return field.slice(9);
  return field;
}

export function DriverHistoryTab({ intakeId }: { intakeId: string }) {
  const t = useTranslations("pages.driverDetail.history");
  const locale = useLocale();
  const [source, setSource] = useState<(typeof FILTERS)[number]>("all");

  const query = useInfiniteQuery({
    queryKey: queryKeys.drivers.history(intakeId, source),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listDriverChangeEvents({
        intakeId,
        source,
        cursor: pageParam,
      });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows: DriverChangeEventRow[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.rows) ?? [],
    [query.data],
  );

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border p-4">
        {FILTERS.map((key) => (
          <ToggleChip
            key={key}
            selected={source === key}
            icon={FILTER_ICONS[key]}
            onClick={() => setSource(key)}
          >
            {key === "all" ? t("filterAll") : t(`source.${key}`)}
          </ToggleChip>
        ))}
      </div>

      {query.isError ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t("loadFailed")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("loadFailedHint")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 h-9 cursor-pointer"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : query.isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12">
          <AppEmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        </div>
      ) : (
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted/80">
              <tr>
                <th className={`${TABLE_HEAD_CLASS} px-3 py-2`}>{t("colWhen")}</th>
                <th className={`${TABLE_HEAD_CLASS} px-3 py-2`}>{t("colWho")}</th>
                <th className={`${TABLE_HEAD_CLASS} px-3 py-2`}>{t("colWhat")}</th>
                <th className={`${TABLE_HEAD_CLASS} px-3 py-2`}>{t("colChanges")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border/60 align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                    {formatWhen(row.created_at, locale)}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">{row.actor_name}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-semibold">
                      {DRIVER_CHANGE_SOURCES.includes(row.source)
                        ? t(`source.${row.source}`)
                        : row.source}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.changes.length === 0 ? (
                      <span className="text-muted-foreground">
                        {typeof row.context.note === "string" ? row.context.note : "—"}
                      </span>
                    ) : (
                      <ul className="space-y-0.5">
                        {row.changes.map((change) => (
                          <li key={change.field} className="flex flex-wrap gap-x-2">
                            <span className="font-medium text-foreground">
                              {fieldLabel(change.field, t)}
                            </span>
                            <span className="text-muted-foreground">
                              {change.before ?? "—"}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-foreground">{change.after ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.hasNextPage ? (
            <div className="border-t border-border p-3 text-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 cursor-pointer gap-1 text-xs"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
