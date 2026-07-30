"use client";

import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Camera, ImageOff, Loader2 } from "lucide-react";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query/query-keys";
import {
  listDriverLoginVerifications,
  type LoginVerificationCursor,
  type LoginVerificationListItem,
} from "./driver-login-verification-actions";

function formatCapturedAt(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function VerificationCard({
  item,
  locale,
  previewLabel,
  livenessVerifiedLabel,
  livenessNotVerifiedLabel,
}: {
  item: LoginVerificationListItem;
  locale: string;
  previewLabel: string;
  livenessVerifiedLabel: string;
  livenessNotVerifiedLabel: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const label = formatCapturedAt(item.capturedAt, locale);

  return (
    <>
      <div className="flex min-h-[10rem] flex-col rounded-xl border border-border bg-card px-3 py-3 shadow-sm">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <span
          className={
            item.livenessPassed
              ? "mt-1 inline-flex w-fit rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
              : "mt-1 inline-flex w-fit rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
          }
        >
          {item.livenessPassed
            ? livenessVerifiedLabel
            : livenessNotVerifiedLabel}
        </span>
        <div className="mt-2 flex flex-1 flex-col">
          {item.signedUrl ? (
            <button
              type="button"
              className="group relative aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-muted"
              onClick={() => setPreviewOpen(true)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.signedUrl}
                alt=""
                className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1.5 text-start text-[10px] font-medium text-white">
                {previewLabel}
              </span>
            </button>
          ) : (
            <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/40">
              <ImageOff className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </div>
      </div>

      {item.signedUrl ? (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-[min(92vw,720px)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="border-b border-border px-4 py-3">
              <DialogTitle className="text-sm font-semibold">{label}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[min(80vh,640px)] overflow-auto bg-muted/30 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.signedUrl}
                alt=""
                className="mx-auto max-h-[min(78vh,600px)] w-auto max-w-full rounded-md object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function DriverLoginVerificationTab({ driverId }: { driverId: string }) {
  const t = useTranslations("pages.driverDetail");
  const locale = useLocale();
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [appliedStart, setAppliedStart] = useState<string | null>(null);
  const [appliedEnd, setAppliedEnd] = useState<string | null>(null);

  const applyFilters = useCallback(() => {
    setAppliedStart(draftStart.trim() || null);
    setAppliedEnd(draftEnd.trim() || null);
  }, [draftStart, draftEnd]);

  const clearFilters = useCallback(() => {
    setDraftStart("");
    setDraftEnd("");
    setAppliedStart(null);
    setAppliedEnd(null);
  }, []);

  const query = useInfiniteQuery({
    queryKey: queryKeys.drivers.loginVerifications(
      driverId,
      appliedStart,
      appliedEnd,
    ),
    queryFn: async ({ pageParam }) => {
      const result = await listDriverLoginVerifications({
        driverId,
        cursor: (pageParam as LoginVerificationCursor | null) ?? null,
        startDate: appliedStart,
        endDate: appliedEnd,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result;
    },
    initialPageParam: null as LoginVerificationCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(driverId),
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data?.pages],
  );

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {t("loginVerificationTitle")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("loginVerificationSummary")}
          </p>
        </div>
        <Camera className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="grid flex-1 gap-1.5 sm:max-w-[11rem]">
          <Label htmlFor="login-verify-start" className="text-xs">
            {t("loginVerificationStartDate")}
          </Label>
          <Input
            id="login-verify-start"
            type="date"
            value={draftStart}
            onChange={(e) => setDraftStart(e.target.value)}
            className="h-9 cursor-pointer rounded-lg"
          />
        </div>
        <div className="grid flex-1 gap-1.5 sm:max-w-[11rem]">
          <Label htmlFor="login-verify-end" className="text-xs">
            {t("loginVerificationEndDate")}
          </Label>
          <Input
            id="login-verify-end"
            type="date"
            value={draftEnd}
            onChange={(e) => setDraftEnd(e.target.value)}
            className="h-9 cursor-pointer rounded-lg"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-lg"
            onClick={applyFilters}
          >
            {t("loginVerificationApplyFilters")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 cursor-pointer rounded-lg"
            onClick={clearFilters}
          >
            {t("loginVerificationClearFilters")}
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loginVerificationLoading")}
        </div>
      ) : query.isError ? (
        <div className="py-12 text-center">
          <p className="text-sm text-destructive">
            {t("loginVerificationError")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 cursor-pointer rounded-lg"
            onClick={() => query.refetch()}
          >
            {t("tryAgain")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="py-8">
          <AppEmptyState
            title={t("loginVerificationEmptyTitle")}
            description={t("loginVerificationEmptyDescription")}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <VerificationCard
                key={item.id}
                item={item}
                locale={locale}
                previewLabel={t("loginVerificationPreview")}
                livenessVerifiedLabel={t("loginVerificationLivenessVerified")}
                livenessNotVerifiedLabel={t(
                  "loginVerificationLivenessNotVerified",
                )}
              />
            ))}
          </div>
          {query.hasNextPage ? (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer rounded-lg"
                disabled={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? (
                  <>
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                    {t("loginVerificationLoading")}
                  </>
                ) : (
                  t("loginVerificationLoadMore")
                )}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
