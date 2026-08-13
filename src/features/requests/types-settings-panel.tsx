"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Lock, Plus, Shapes } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchRequestTypeDefinitions,
  updateRequestType,
} from "./request-type-builder-actions";
import { RequestTypeFormDialog } from "./request-type-form-dialog";
import type { RequestTypeDefinitionRow } from "./settings-types";

export function TypesSettingsPanel() {
  const t = useTranslations("pages.requests.settings.types");
  const tRoot = useTranslations("pages.requests");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const addOpen = searchParams.get("add") === "1";

  const [rows, setRows] = useState<RequestTypeDefinitionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchRequestTypeDefinitions();
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setRows(result.rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nextSortOrder = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 1,
    [rows],
  );

  function setAddOpen(open: boolean) {
    router.replace(open ? `${pathname}?add=1` : pathname);
  }

  function toggle(
    row: RequestTypeDefinitionRow,
    field: "screenshot_restricted" | "is_active",
  ) {
    const next = !row[field];
    setRows((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, [field]: next } : r)),
    );
    startTransition(async () => {
      const result = await updateRequestType(row.key, { [field]: next });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, [field]: !next } : r)),
        );
      }
    });
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tRoot("title"), href: "/requests" },
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
        actions={
          <Button type="button" size="sm" className="h-9" onClick={() => setAddOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t("addRequestType")}
          </Button>
        }
      />

      <AppListCard className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colType")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colFields")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colChain")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colRequests")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colScreenshots")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                  {t("loading")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                        <Shapes className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{row.label_en}</span>
                          {row.is_system ? (
                            <span
                              title={t("systemLockHint")}
                              className="inline-flex items-center gap-0.5 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary"
                            >
                              <Lock className="h-2.5 w-2.5" />
                              {t("systemBadge")}
                            </span>
                          ) : null}
                        </div>
                        <Link
                          href={`/requests/settings/types/${row.key}`}
                          className="text-[11px] text-primary hover:underline"
                        >
                          {t("viewDetails")}
                        </Link>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.field_count}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.step_count > 0 ? (
                      t("stepsCount", { count: row.step_count })
                    ) : (
                      <span className="text-warning">{t("noChain")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.request_count}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.screenshot_restricted}
                        onCheckedChange={() => toggle(row, "screenshot_restricted")}
                        aria-label={t("colScreenshots")}
                      />
                      <span className="text-xs text-muted-foreground">
                        {row.screenshot_restricted ? t("blocked") : t("allowed")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={row.is_active}
                      onCheckedChange={() => toggle(row, "is_active")}
                      aria-label={t("colStatus")}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AppListCard>

      <p className="text-[10px] text-muted-foreground">{t("systemLockNote")}</p>

      <RequestTypeFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        nextSortOrder={nextSortOrder}
        onSaved={load}
      />
    </AppPage>
  );
}
