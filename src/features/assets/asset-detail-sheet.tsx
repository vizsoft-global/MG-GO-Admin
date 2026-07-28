"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
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
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AssetCatalogIcon } from "./asset-catalog-icon";
import { isAssetErrorKey } from "./asset-errors";
import {
  useAdjustAssetStock,
  useAssetDetail,
  useReturnAssetAssignment,
} from "./use-assets";
import type { AssetCatalogRow } from "./types";

function assetErrorToast(
  t: ReturnType<typeof useTranslations<"pages.assets">>,
  error?: string,
) {
  if (error && isAssetErrorKey(error)) return t(`errors.${error}`);
  return t("errors.save_failed");
}

function formatDate(iso: string, locale: string) {
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

export function AssetDetailSheet({
  asset,
  open,
  onOpenChange,
  onEdit,
}: {
  asset: AssetCatalogRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (asset: AssetCatalogRow) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("pages.assets");
  const { can } = useAuth();
  const canManage = can("assets.manage");
  const { data: detail, isLoading, refetch } = useAssetDetail(asset?.id ?? null, open);
  const returnMutation = useReturnAssetAssignment();
  const adjustMutation = useAdjustAssetStock();
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustNote, setAdjustNote] = useState("");
  const [showAdjust, setShowAdjust] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      setShowAdjust(false);
      setAdjustDelta("1");
      setAdjustNote("");
    }
  }, [open]);

  const display = detail ?? asset;
  if (!display) return null;

  const handleReturn = (assignmentId: string) => {
    startTransition(async () => {
      const result = await returnMutation.mutateAsync(assignmentId);
      if (result.error) {
        toast.error(assetErrorToast(t, result.error));
        return;
      }
      toast.success(t("returned"));
      void refetch();
    });
  };

  const handleAdjust = (delta: number) => {
    if (!asset) return;
    startTransition(async () => {
      const result = await adjustMutation.mutateAsync({
        id: asset.id,
        delta,
        note: adjustNote.trim() || undefined,
      });
      if (result.error) {
        toast.error(assetErrorToast(t, result.error));
        return;
      }
      toast.success(t("stockAdjusted"));
      setShowAdjust(false);
      void refetch();
    });
  };

  const driverHref = (assignment: { driver_id: string | null; intake_id: string | null }) => {
    const id = assignment.driver_id ?? assignment.intake_id;
    return id ? `/${locale}/drivers/${id}` : null;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full max-h-[100dvh] flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40 p-1">
              <AssetCatalogIcon
                iconKey={display.icon_key}
                imageUrl={display.image_url}
                imgClassName="h-full w-full"
                iconClassName="h-4 w-4"
              />
            </span>
            {display.name}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">{display.code}</p>
        </SheetHeader>

        <SheetBody className="space-y-4 overflow-y-auto">
          {isLoading && !detail ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-[10px] uppercase text-muted-foreground">{t("colInStock")}</p>
                  <p className="text-lg font-semibold tabular-nums">{display.total_quantity}</p>
                </div>
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-[10px] uppercase text-muted-foreground">{t("colAssigned")}</p>
                  <p className="text-lg font-semibold tabular-nums">{display.assigned_qty}</p>
                </div>
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-[10px] uppercase text-muted-foreground">{t("colAvailable")}</p>
                  <p
                    className={`text-lg font-semibold tabular-nums ${
                      display.is_low_stock ? "text-amber-600" : ""
                    }`}
                  >
                    {display.available_qty}
                  </p>
                </div>
              </div>

              {display.description ? (
                <p className="text-sm text-muted-foreground">{display.description}</p>
              ) : null}

              {canManage ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t("adjustStockTitle")}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAdjust((v) => !v)}
                    >
                      {t("adjustStock")}
                    </Button>
                  </div>
                  {showAdjust ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={isPending}
                          onClick={() => handleAdjust(-1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input
                          type="number"
                          value={adjustDelta}
                          onChange={(e) => setAdjustDelta(e.target.value)}
                          className="h-8"
                          disabled={isPending}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={isPending}
                          onClick={() => handleAdjust(1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            const delta = parseInt(adjustDelta, 10);
                            if (!Number.isFinite(delta) || delta === 0) {
                              toast.error(t("errors.invalid_quantity"));
                              return;
                            }
                            handleAdjust(delta);
                          }}
                        >
                          {t("applyAdjust")}
                        </Button>
                      </div>
                      <Input
                        value={adjustNote}
                        onChange={(e) => setAdjustNote(e.target.value)}
                        placeholder={t("adjustNote")}
                        disabled={isPending}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-sm font-semibold">{t("holdersTitle")}</p>
                {(detail?.active_assignments ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noHolders")}</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className={TABLE_HEAD_CLASS}>{t("holderName")}</TableHead>
                          <TableHead className={TABLE_HEAD_CLASS}>{t("assignedAt")}</TableHead>
                          <TableHead className={TABLE_HEAD_CLASS} />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(detail?.active_assignments ?? []).map((row) => {
                          const href = driverHref(row);
                          return (
                            <TableRow key={row.id}>
                              <TableCell>
                                <div>
                                  {href ? (
                                    <Link
                                      href={href}
                                      className="font-medium text-primary hover:underline"
                                    >
                                      {row.holder_name}
                                    </Link>
                                  ) : (
                                    <span className="font-medium">{row.holder_name}</span>
                                  )}
                                  <p className="text-[11px] text-muted-foreground">
                                    {[row.holder_code, row.partner_name].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {formatDate(row.assigned_at, locale)}
                              </TableCell>
                              <TableCell className="text-end">
                                {canManage ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={isPending}
                                    onClick={() => handleReturn(row.id)}
                                  >
                                    {t("returnAsset")}
                                  </Button>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {(detail?.recent_returns ?? []).length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{t("historyTitle")}</p>
                  <div className="space-y-2">
                    {(detail?.recent_returns ?? []).map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="font-medium">{row.holder_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {row.returned_at
                              ? formatDate(row.returned_at, locale)
                              : "—"}
                          </p>
                        </div>
                        <Badge variant="secondary">{t("returned")}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </SheetBody>

        <SheetFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          {canManage && asset ? (
            <Button type="button" onClick={() => onEdit(asset)}>
              {t("editAsset")}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
