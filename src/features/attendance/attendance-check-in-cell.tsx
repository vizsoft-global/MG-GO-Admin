"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageOff } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { resolveAttendancePhoto } from "./attendance-reporting-actions";

type CheckInPhoto = { url: string; contentType: string | null };

/**
 * Lazy check-in proof. The list carries the R2 key only, so a page of 50 rows
 * does not sign 50 URLs the operator never opens.
 */
export function AttendanceCheckInCell({
  photoKey,
  restaurantName,
  distanceM,
}: {
  photoKey: string | null;
  restaurantName: string | null;
  distanceM: number | null;
}) {
  const t = useTranslations("pages.attendance");
  const [photo, setPhoto] = useState<CheckInPhoto | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!photoKey) {
      setPhoto(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void resolveAttendancePhoto(photoKey)
      .then((resolved) => {
        if (cancelled) return;
        if (!resolved) {
          setFailed(true);
          return;
        }
        setPhoto(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [photoKey]);

  if (!photoKey && !restaurantName && distanceM === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const distanceLabel =
    distanceM !== null ? t("checkInPhoto.meters", { meters: Math.round(distanceM) }) : null;

  return (
    <div className="flex items-center gap-2">
      {photoKey ? (
        photo ? (
          <button
            type="button"
            className="size-8 shrink-0 overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpen(true)}
            aria-label={t("checkInPhoto.open")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URL */}
            <img src={photo.url} alt="" className="size-full object-cover" loading="lazy" />
          </button>
        ) : (
          <span
            className="grid size-8 shrink-0 place-items-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground"
            aria-hidden
          >
            <ImageOff className="size-3.5" />
          </span>
        )
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      <span className="min-w-0">
        <span className="block max-w-[9rem] truncate text-[11px] leading-tight">
          {restaurantName ?? (photoKey ? t("checkInPhoto.noRestaurant") : "—")}
        </span>
        {distanceLabel ? (
          <span
            className={`mt-0.5 inline-flex rounded px-1 py-0.5 text-[10px] font-medium tabular-nums ${
              distanceM !== null && distanceM <= 50
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            {distanceLabel}
          </span>
        ) : null}
        {failed ? (
          <span className="block text-[10px] text-muted-foreground">
            {t("checkInPhoto.unavailable")}
          </span>
        ) : null}
      </span>

      {photo ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent showCloseButton closeOutside className="w-[min(560px,96vw)] p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URL */}
            <img
              src={photo.url}
              alt={t("checkInPhoto.open")}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
