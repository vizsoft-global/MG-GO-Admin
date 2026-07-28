"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Filter,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/auth-context";
import { useHasMounted } from "@/hooks/use-has-mounted";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { PartnerFormSheet } from "./partner-form-sheet";
import { usePartnersList } from "./use-partners";
import type { PartnerRow } from "./types";

type DriversFilter = "all" | "withDrivers" | "noDrivers";
type LogoFilter = "all" | "withLogo" | "noLogo";

function exportPartnersCsv(rows: PartnerRow[]) {
  const header = [
    "id",
    "name",
    "slug",
    "description",
    "driver_count",
    "has_logo",
    "created_at",
  ];
  const escape = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((p) =>
      [
        p.id,
        p.name,
        p.slug,
        p.description,
        p.driver_count,
        p.logo_url ? "true" : "false",
        p.created_at,
      ]
        .map(escape)
        .join(","),
    ),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `partners-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatCreatedAt(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function PartnersPageSkeleton() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function PartnersPageContent() {
  const locale = useLocale();
  const t = useTranslations("pages.partners");
  const { can } = useAuth();
  const canManage = can("partners.manage");
  const queryClient = useQueryClient();

  const { data: partners = [], isLoading, refetch } = usePartnersList();
  const [search, setSearch] = useState("");
  const [driversFilter, setDriversFilter] = useState<DriversFilter>("all");
  const [logoFilter, setLogoFilter] = useState<LogoFilter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerRow | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasActiveFilters = driversFilter !== "all" || logoFilter !== "all";

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter((p) => {
      if (
        q &&
        !(
          p.name.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          (p.description?.toLowerCase().includes(q) ?? false)
        )
      ) {
        return false;
      }
      if (driversFilter === "withDrivers" && p.driver_count === 0) return false;
      if (driversFilter === "noDrivers" && p.driver_count > 0) return false;
      if (logoFilter === "withLogo" && !p.logo_url) return false;
      if (logoFilter === "noLogo" && p.logo_url) return false;
      return true;
    });
  }, [partners, search, driversFilter, logoFilter]);

  const invalidatePartners = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.partners.all() });
  }, [queryClient]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAdd = () => {
    setEditingPartner(null);
    setSheetOpen(true);
  };

  const handleEdit = (partner: PartnerRow) => {
    setEditingPartner(partner);
    setSheetOpen(true);
  };

  const clearAllFilters = () => {
    setDriversFilter("all");
    setLogoFilter("all");
  };

  const driversFilterLabel = (value: DriversFilter) => {
    switch (value) {
      case "withDrivers":
        return t("filterWithDrivers");
      case "noDrivers":
        return t("filterNoDrivers");
      default:
        return t("filterDriversAll");
    }
  };

  const logoFilterLabel = (value: LogoFilter) => {
    switch (value) {
      case "withLogo":
        return t("filterWithLogo");
      case "noLogo":
        return t("filterNoLogo");
      default:
        return t("filterLogoAll");
    }
  };

  const showEmptySearch =
    !isLoading && partners.length > 0 && visible.length === 0;
  const showEmptyAll = !isLoading && partners.length === 0;

  const tableColumns = useMemo(() => {
    const cols = [
      { id: "logo", label: t("colLogo"), className: "w-14" },
      { id: "partner", label: t("colPartner") },
      { id: "description", label: t("colDescription"), className: "hidden md:table-cell" },
      { id: "drivers", label: t("colDrivers") },
      { id: "created", label: t("colCreated"), className: "hidden sm:table-cell" },
    ];
    if (canManage) {
      cols.push({ id: "actions", label: t("colActions"), className: "w-12 text-end" });
    }
    return cols;
  }, [canManage, t]);

  const countLabel =
    visible.length !== partners.length
      ? `${t("totalPartners", { count: visible.length })} ${t("ofTotal", { total: partners.length })}`
      : t("totalPartners", { count: visible.length });

  const filterMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-9 shrink-0 cursor-pointer rounded-lg",
        )}
      >
        <Filter className="me-2 h-3.5 w-3.5" />
        {t("filter")}
        {hasActiveFilters ? (
          <Badge
            variant="secondary"
            className="ms-2 h-5 min-w-5 rounded-full px-1.5 text-[10px]"
          >
            {(driversFilter !== "all" ? 1 : 0) + (logoFilter !== "all" ? 1 : 0)}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("filterDrivers")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={driversFilter}
            onValueChange={(v) => setDriversFilter((v as DriversFilter) ?? "all")}
          >
            <DropdownMenuRadioItem value="all">
              {t("filterDriversAll")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="withDrivers">
              {t("filterWithDrivers")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="noDrivers">
              {t("filterNoDrivers")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("filterLogo")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={logoFilter}
            onValueChange={(v) => setLogoFilter((v as LogoFilter) ?? "all")}
          >
            <DropdownMenuRadioItem value="all">
              {t("filterLogoAll")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="withLogo">
              {t("filterWithLogo")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="noLogo">
              {t("filterNoLogo")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={`me-2 h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
                {t("refresh")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                onClick={() => exportPartnersCsv(visible)}
                disabled={visible.length === 0}
              >
                <Download className="me-2 h-3.5 w-3.5" />
                {t("export")}
              </Button>
              {canManage ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  onClick={handleAdd}
                >
                  <Plus className="me-2 h-3.5 w-3.5" />
                  {t("addPartner")}
                </Button>
              ) : null}
            </div>
        }
      />
      <AppListCard
        toolbar={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-9 rounded-lg bg-background ps-9 pe-9"
                aria-label={t("searchPlaceholder")}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute end-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label={t("clearSearch")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {filterMenu}
              <div
                className="hidden h-6 w-px shrink-0 bg-border sm:block"
                aria-hidden
              />
              <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {countLabel}
              </p>
            </div>
          </div>
        }
        filterChips={
          hasActiveFilters ? (
            <>
              {driversFilter !== "all" ? (
                <Badge variant="secondary" className="gap-1 rounded-lg pe-1">
                  {t("filterDrivers")}: {driversFilterLabel(driversFilter)}
                  <button
                    type="button"
                    className="cursor-pointer rounded p-0.5 hover:bg-muted"
                    onClick={() => setDriversFilter("all")}
                    aria-label={t("clearFilters")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              {logoFilter !== "all" ? (
                <Badge variant="secondary" className="gap-1 rounded-lg pe-1">
                  {t("filterLogo")}: {logoFilterLabel(logoFilter)}
                  <button
                    type="button"
                    className="cursor-pointer rounded p-0.5 hover:bg-muted"
                    onClick={() => setLogoFilter("all")}
                    aria-label={t("clearFilters")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              <button
                type="button"
                className="cursor-pointer text-xs text-primary hover:underline"
                onClick={clearAllFilters}
              >
                {t("clearFilters")}
              </button>
            </>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : showEmptyAll ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("emptyDescription")}</p>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                className="mt-4 cursor-pointer rounded-lg"
                onClick={handleAdd}
              >
                <Plus className="me-2 h-3.5 w-3.5" />
                {t("addPartner")}
              </Button>
            ) : null}
          </div>
        ) : (
          <CardContent className="p-0">
            <AppDataTable
              columns={tableColumns}
              empty={
                showEmptySearch ? (
                  <AppDataTableEmpty>
                    <AppEmptyState
                      title={t("emptySearchTitle")}
                      description={t("emptySearchDescription")}
                    />
                  </AppDataTableEmpty>
                ) : undefined
              }
            >
              {!showEmptySearch
                ? visible.map((partner) => (
                    <AppDataTableRow
                      key={partner.id}
                      role={canManage ? "button" : undefined}
                      tabIndex={canManage ? 0 : undefined}
                      className={cn(canManage && "cursor-pointer")}
                      onClick={() => canManage && handleEdit(partner)}
                      onKeyDown={(e) => {
                        if (
                          canManage &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault();
                          handleEdit(partner);
                        }
                      }}
                    >
                      <TableCell>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                          {partner.logo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={partner.logo_url}
                              alt=""
                              className="h-full w-full object-contain p-0.5"
                            />
                          ) : (
                            <span className="text-sm font-semibold text-muted-foreground">
                              {partner.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {partner.name}
                          </p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {partner.slug}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-xs md:table-cell">
                        {partner.description ? (
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {partner.description}
                          </p>
                        ) : (
                          <p className="text-sm italic text-muted-foreground/70">
                            {t("noDescription")}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t("driversCount", { count: partner.driver_count })}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {formatCreatedAt(partner.created_at, locale)}
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(partner);
                            }}
                            aria-label={t("editPartner")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </AppDataTableRow>
                  ))
                : null}
            </AppDataTable>
          </CardContent>
        )}
      </AppListCard>

      <PartnerFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        partner={editingPartner}
        onSaved={invalidatePartners}
        onDeleted={invalidatePartners}
      />
    </AppPage>
  );
}

export function PartnersPageShell() {
  const mounted = useHasMounted();
  if (!mounted) return <PartnersPageSkeleton />;
  return (
    <PartnersPageContent />
  );
}
