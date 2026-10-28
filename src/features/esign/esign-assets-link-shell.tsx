"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Package } from "lucide-react";
import { groupRows } from "@/components/app/app-list-controls";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { selectOptions } from "@/lib/select-items";
import { fetchAssetsCatalog } from "@/features/assets/assets-actions";
import type { AssetCatalogRow } from "@/features/assets/types";

export function EsignAssetsLinkShell() {
  const t = useTranslations("pages.requests.esign.assets");
  const tRoot = useTranslations("pages.requests");
  const tSettings = useTranslations("pages.requests.settings");
  const tAssets = useTranslations("pages.assets");
  const [rows, setRows] = useState<AssetCatalogRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    fetchAssetsCatalog()
      .then((result) => setRows(result.items))
      .catch(() => setForbidden(true));
  }, []);

  const categoryOptions = useMemo(() => {
    const found = Array.from(
      new Set((rows ?? []).map((row) => row.category).filter((c): c is string => Boolean(c))),
    ).sort((a, b) => a.localeCompare(b));
    return selectOptions([
      { value: "all", label: t("allCategories") },
      ...found.map((c) => ({ value: c, label: c })),
    ]);
  }, [rows, t]);

  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "name", label: t("colName"), locked: true },
      { id: "category", label: tAssets("colCategory"), categorical: true },
      { id: "stock", label: t("colStock") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "penalty", label: tAssets("colPenalty") },
    ],
    [t, tAssets],
  );
  const prefs = useTablePrefs("esign.assets", columns);
  useEffect(() => {
    setSearch(prefs.appliedQuery);
  }, [prefs.appliedQuery]);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const visibleRows = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (category !== "all" && row.category !== category) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.code.toLowerCase().includes(q);
    });
  }, [rows, search, category]);

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={
          rows ? `${t("subtitle")} · ${t("assetCount", { count: rows.length })}` : t("subtitle")
        }
        breadcrumbs={[
          { label: tRoot("title"), href: "/requests" },
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
          <TableToolbar
            prefs={prefs}
            entity={t("title")}
            columns={columns}
            rowKind="dynamic"
            entityList
            filteredCount={visibleRows?.length ?? 0}
            totalCount={rows?.length ?? 0}
          />
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <Select value={category} onValueChange={(v) => v && setCategory(v)} items={categoryOptions}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ms-auto text-xs text-muted-foreground">
              {visibleRows ? t("assetCount", { count: visibleRows.length }) : ""}
            </span>
          </div>
          {visibleRows && visibleRows.length > 0 && prefs.view === "grid" ? (
            <TableGridCards
              rows={visibleRows.map((row) => ({
                id: row.code || row.id,
                name: row.name,
                fields: [
                  { label: tAssets("colCategory"), value: row.category || "—" },
                  {
                    label: t("colStock"),
                    value:
                      row.available_qty <= 0
                        ? t("outOfStock")
                        : row.is_low_stock
                          ? t("lowStock", { count: row.available_qty })
                          : t("inStock", { count: row.available_qty }),
                  },
                  { label: t("colStatus"), value: row.is_active ? t("activeOn") : t("activeOff") },
                  {
                    label: tAssets("colPenalty"),
                    value: row.penalty_kwd != null ? `${row.penalty_kwd.toFixed(3)} KWD` : "—",
                  },
                ],
              }))}
            />
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {shown.map((column) => (
                  <TableHead key={column.id} className={TABLE_HEAD_CLASS}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows === null ? (
                <TableRow>
                  <TableCell colSpan={shown.length} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={shown.length} className="py-8 text-center text-sm text-muted-foreground">
                    {t("empty")}
                  </TableCell>
                </TableRow>
              ) : (
                groupRows(
                  visibleRows,
                  prefs.groupBy,
                  {
                    category: (row) => row.category ?? "",
                    status: (row) => (row.is_active ? t("activeOn") : t("activeOff")),
                  },
                  {},
                  "—",
                ).flatMap((group) => [
                  ...(prefs.groupBy !== "none"
                    ? [
                        <TableRow key={`g-${group.key}`}>
                          <TableCell colSpan={shown.length} className="text-xs font-semibold">
                            {group.label} · {group.rows.length}
                          </TableCell>
                        </TableRow>,
                      ]
                    : []),
                  ...group.rows.map((row) => {
                    const cells: Record<string, ReactNode> = {
                      name: (
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                            <Package className="h-4 w-4" />
                          </span>
                          <div>
                            <TableNameCell name={row.name} />
                            <p className="text-xs text-muted-foreground">{row.code}</p>
                          </div>
                        </div>
                      ),
                      category: row.category ? (
                        <Badge variant="secondary" className="font-normal">
                          {row.category}
                        </Badge>
                      ) : (
                        <EmptyCell />
                      ),
                      stock:
                        row.available_qty <= 0 ? (
                          <span className="text-destructive">{t("outOfStock")}</span>
                        ) : row.is_low_stock ? (
                          <span className="text-destructive">
                            {t("lowStock", { count: row.available_qty })}
                          </span>
                        ) : (
                          t("inStock", { count: row.available_qty })
                        ),
                      status: (
                        <StatusPill variant={row.is_active ? "success" : "neutral"}>
                          {row.is_active ? t("activeOn") : t("activeOff")}
                        </StatusPill>
                      ),
                      penalty:
                        row.penalty_kwd != null ? (
                          `${row.penalty_kwd.toFixed(3)} KWD`
                        ) : (
                          <EmptyCell />
                        ),
                    };
                    return (
                      <TableRow key={row.id}>
                        {shown.map((column) => (
                          <TableCell key={column.id} className="text-sm">
                            {cells[column.id]}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  }),
                ])
              )}
            </TableBody>
          </Table>
          )}
        </AppListCard>
      )}
    </AppPage>
  );
}
