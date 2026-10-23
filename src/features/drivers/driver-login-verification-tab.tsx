"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Camera, ImageOff, Loader2 } from "lucide-react";
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
      <div className="flex min-h-[10rem] flex-col rounded-[14px] border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <span
          className={
            item.livenessPassed
              ? "mt-1 inline-flex w-fit rounded-full bg-[#E3F1E6] px-2.5 py-[3px] text-xs font-semibold text-[#1F5C2E]"
              : "mt-1 inline-flex w-fit rounded-full bg-[#F2F2F5] px-2.5 py-[3px] text-xs font-semibold text-muted-foreground"
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
              className="relative aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-muted"
              onClick={() => setPreviewOpen(true)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.signedUrl}
                alt=""
                className="h-full w-full object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1.5 text-start text-xs font-medium text-white">
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

export function DriverLoginVerificationTab({
  driverId,
  controls,
}: {
  driverId: string;
  /** App access + security controls, rendered by the Profile shell. */
  controls?: ReactNode;
}) {
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
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">
          {t("tabLoginVerification")}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("loginVerificationControlsHint")}
        </p>
      </div>

      <section className="w-full rounded-[14px] border border-border bg-card px-5 py-[18px]">
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#F7E9E4] text-sidebar-primary">
            <Camera className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">
              {t("loginVerificationTitle")}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("loginVerificationSummary")}
            </p>
          </div>
        </div>

        <div className="mt-4 flex w-full flex-col gap-3 rounded-[10px] border border-border bg-[#F7F6F4] p-3 min-[560px]:flex-row min-[560px]:flex-wrap min-[560px]:items-end">
          <div className="grid min-w-[180px] flex-1 gap-1.5">
            <Label htmlFor="login-verify-start" className="text-sm font-semibold text-muted-foreground">
              {t("loginVerificationStartDate")}
            </Label>
            <Input
              id="login-verify-start"
              type="date"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              className="h-[42px] min-h-[42px] cursor-pointer rounded-lg px-3"
            />
          </div>
          <div className="grid min-w-[180px] flex-1 gap-1.5">
            <Label htmlFor="login-verify-end" className="text-sm font-semibold text-muted-foreground">
              {t("loginVerificationEndDate")}
            </Label>
            <Input
              id="login-verify-end"
              type="date"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              className="h-[42px] min-h-[42px] cursor-pointer rounded-lg px-3"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              className="h-10 min-h-10 cursor-pointer rounded-lg bg-[#292A3F] px-4 text-white hover:bg-[#292A3F]/90"
              onClick={applyFilters}
            >
              {t("loginVerificationApplyFilters")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 min-h-10 cursor-pointer rounded-lg px-4"
              onClick={clearFilters}
            >
              {t("loginVerificationClearFilters")}
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loginVerificationLoading")}
          </div>
        ) : query.isError ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">
              {t("loginVerificationError")}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-10 min-h-10 cursor-pointer rounded-lg"
              onClick={() => query.refetch()}
            >
              {t("tryAgain")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-9 text-center">
            <p className="text-sm font-semibold text-foreground">
              {t("loginVerificationEmptyTitle")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("loginVerificationEmptyDescription")}
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
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
              <div className="flex justify-center pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 min-h-10 cursor-pointer rounded-lg"
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
      </section>

      {controls ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:contents">
          {controls}
        </div>
      ) : null}
    </div>
  );
}

