"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { EmployeeCatalogPanel } from "@/features/employees/employee-catalog-panel";
import { DriverFieldsSettingsPanel } from "@/features/custom-fields/driver-fields-settings-panel";
import { AttendanceSettingsPanel } from "@/features/attendance/attendance-settings-panel";
import { ServiceTypesPanel } from "@/features/fleet/service/service-types-panel";
import { VehicleTypesPanel } from "@/features/vehicles/vehicle-types-panel";
import { PayrollClientsPanel } from "@/features/payroll/payroll-clients-panel";
import {
  visibleEmployeeSettingsTiles,
  type EmployeeSettingsTile,
} from "./employee-settings-tiles";

/**
 * Employee Settings — the header door to every employee catalog.
 *
 * The catalogs open **inside this dialog**, never by routing. Clicking Job
 * positions used to `router.push("/settings/job-positions")`, which left the
 * Employees page, dropped the operator's filters and lit a different sidebar
 * row; the sidebar stayed on Settings while they were editing the list's own
 * master data. Now a tile swaps the body to that editor, the sidebar keeps
 * pointing at Employees, and Back returns to the grid without closing.
 *
 * The editors are the module panels themselves, not copies: the same table, the
 * same search, the same Add / Edit / Delete, the same server actions. Each one
 * falls back to reading its own catalog when the page did not hand it rows, so
 * nothing here needs a server render of `/settings/*`.
 */
export function EmployeeSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.drivers.employeeSettings");
  const { permissions, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const tiles = visibleEmployeeSettingsTiles(permissions, isSuperAdmin);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const active = tiles.find((tile) => tile.key === activeKey) ?? null;
  /**
   * Closing resets the sheet to the grid and drops the cached catalogs, so the
   * next open reflects an edit made on another surface. Done in the handler
   * rather than an effect: a synchronous `setState` in an effect body is the
   * cascading-render pattern the React compiler flags, and there is nothing
   * external to synchronise here.
   */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setActiveKey(null);
      void queryClient.invalidateQueries({ queryKey: ["employees", "catalog"] });
    }
    onOpenChange(next);
  };

  const title = active ? t(`tiles.${active.key}`) : t("title");
  /**
   * A catalog editor is a wide table, so the sheet grows while one is open and
   * returns to the tile grid's narrower width on Back.
   *
   * Both `w-` **and** `max-w-` are set: `DialogContent` carries `w-full max-w-lg`
   * by default, and a lone `w-[…]` leaves that 512px cap in place — which is why
   * a catalog table was cramped however wide the class asked for. `max-w-[…]`
   * wins over the component's `max-w-lg` through `cn`'s merge, so the sheet can
   * actually reach the width it asks for while 98vw keeps a gutter on a phone.
   */
  const widthClass = active
    ? "w-[min(1560px,98vw)] max-w-[min(1560px,98vw)]"
    : "w-[min(1200px,96vw)] max-w-[min(1200px,96vw)]";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className={`flex h-[min(88dvh,900px)] flex-col gap-0 overflow-visible p-0 ${widthClass}`}
      >
        <div
          className={`flex min-h-0 flex-1 flex-col gap-2 pt-4 ${active ? "px-3 sm:px-5" : "px-5"}`}
        >
          {active ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0"
                onClick={() => setActiveKey(null)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t("backToSettings")}
              </Button>
              <p className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          )}

          <div
            className={`min-h-0 flex-1 overflow-y-auto overflow-x-auto rounded-xl border border-border bg-card [&_h1]:hidden ${
              active ? "p-2 sm:p-3" : "p-4"
            }`}
          >
            {active ? (
              <EmployeeSettingsEditor tile={active} />
            ) : tiles.length === 0 ? (
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
                      onClick={() => setActiveKey(tile.key)}
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
        </div>

        <div className="p-3">
          <AppModalFooter
            title={title}
            subtitle={active ? t("embeddedHint") : t("subtitle")}
          >
            {active ? (
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => setActiveKey(null)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t("backToSettings")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="h-9" onClick={() => handleOpenChange(false)}>
              {t("close")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeSettingsEditor({ tile }: { tile: EmployeeSettingsTile }) {
  const t = useTranslations("pages.drivers.employeeSettings");
  const label = t(`tiles.${tile.key}`);

  switch (tile.view.kind) {
    case "catalog":
      return (
        <EmployeeCatalogPanel
          kind={tile.view.catalog}
          title={label}
          subtitle={t("embeddedHint")}
        />
      );
    case "serviceTypes":
      return <ServiceTypesPanel />;
    case "attendance":
      return <AttendanceSettingsPanel />;
    case "vehicleTypes":
      return <VehicleTypesPanel />;
    case "driverFields":
      return <DriverFieldsSettingsPanel />;
    case "clients":
      return <PayrollClientsPanel title={label} subtitle={t("embeddedHint")} showActions={false} />;
    default: {
      const never: never = tile.view;
      return never;
    }
  }
}
