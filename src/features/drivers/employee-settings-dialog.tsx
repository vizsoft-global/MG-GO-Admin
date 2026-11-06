"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { visibleEmployeeSettingsTiles } from "./employee-settings-tiles";

/**
 * Employee Settings — the header door to every employee catalog.
 *
 * The Operations Hub used to carry these six tiles in a second group; they live
 * here now, next to the list they configure, and the hub keeps only the
 * operational doors. The tile list is permission-filtered, so an operator who
 * may not manage vehicles does not see a Vehicles tile that would 307 them to
 * `/unauthorized`.
 */
export function EmployeeSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.drivers.employeeSettings");
  const router = useRouter();
  const { permissions, isSuperAdmin } = useAuth();
  const tiles = visibleEmployeeSettingsTiles(permissions, isSuperAdmin);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(720px,96vw)]">
        <div className="max-h-[min(70dvh,560px)] overflow-y-auto p-1">
          <p className="px-1 pb-3 text-sm text-muted-foreground">{t("subtitle")}</p>
          {tiles.length === 0 ? (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => go(tile.href)}
                    className="flex min-h-[76px] cursor-pointer flex-col items-start justify-between gap-2 rounded-xl border border-border bg-card p-4 text-start transition-colors hover:bg-muted/50"
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {t(`tiles.${tile.key}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <AppModalFooter title={t("title")} subtitle={t("subtitle")}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
