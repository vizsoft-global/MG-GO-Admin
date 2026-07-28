"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppReleaseDrivers } from "./use-app-releases";
import type { AppReleaseAdoptionRow, AppReleaseChannel } from "./types";

function formatSeenAt(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function AppReleasesDriversSheet({
  open,
  onOpenChange,
  channel,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: AppReleaseChannel;
  row: AppReleaseAdoptionRow | null;
}) {
  const t = useTranslations("pages.appReleases.adoption.drilldown");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    if (open) {
      setSearch("");
      setPage(1);
    }
  }, [open, row?.version_code]);

  const { data, isLoading, isFetching } = useAppReleaseDrivers(
    channel,
    row?.version_code ?? null,
    search,
    page,
    open && row != null,
  );

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const title =
    row?.version_code == null
      ? t("titleUnknown")
      : t("titleVersion", {
          version: row.version_name,
          code: row.version_code,
        });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {t("description", { count: data?.total ?? row?.driver_count ?? 0 })}
          </SheetDescription>
        </SheetHeader>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t("searchPlaceholder")}
            className="rounded-lg ps-9"
          />
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.driver")}</TableHead>
                  <TableHead>{t("columns.partner")}</TableHead>
                  <TableHead>{t("columns.lastSeen")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((driver) => (
                  <TableRow key={driver.driver_id}>
                    <TableCell>
                      <div className="font-medium">{driver.driver_code}</div>
                      <div className="text-xs text-muted-foreground">
                        {driver.full_name ?? "—"}
                        {driver.phone ? ` · ${driver.phone}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>{driver.partner_name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="text-sm">{formatSeenAt(driver.app_version_seen_at)}</div>
                      {driver.version_code != null ? (
                        <Badge variant="outline" className="mt-1">
                          {driver.version_name ?? driver.version_code}
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer rounded-lg"
            disabled={page <= 1 || isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("pageOf", { page, total: totalPages })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer rounded-lg"
            disabled={page >= totalPages || isFetching}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
