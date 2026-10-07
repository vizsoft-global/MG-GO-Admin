"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SearchSelect } from "@/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectBadge } from "@/features/fleet/fleet-badges";
import { isDriverProjectKey } from "@/features/fleet/fleet-labels";
import { queryKeys } from "@/lib/query/query-keys";
import { listVehicleTabDrivers } from "./vehicle-tabs-actions";
import { bulkAssignVehicleDrivers, bulkUpdateVehicles, listVehiclePartners } from "./vehicles-actions";
import type { VehicleListRow, VehicleStatus } from "./types";

export function VehicleBulkBar({
  rows,
  onDone,
}: {
  rows: VehicleListRow[];
  onDone: () => void;
}) {
  const t = useTranslations("pages.vehicles");
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [status, setStatus] = useState<VehicleStatus | "">("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const ids = rows.map((row) => row.id);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
    onDone();
  };

  const applyStatus = () => {
    if (!status) return;
    startTransition(async () => {
      const result = await bulkUpdateVehicles(ids, { status });
      if (result.error) {
        toast.error(t("errors.save_failed"));
        return;
      }
      toast.success(t("bulkUpdated", { count: result.updated ?? ids.length }));
      refresh();
    });
  };

  const applyCompany = () => {
    startTransition(async () => {
      const result = await bulkUpdateVehicles(ids, { ownerPartnerId: companyId });
      if (result.error) {
        toast.error(t("errors.save_failed"));
        return;
      }
      toast.success(t("bulkUpdated", { count: result.updated ?? ids.length }));
      refresh();
    });
  };

  // Suspend, deliberately not "archive": `vehicles` has no `archived_at`, so
  // this writes `status = 'suspended'` and the copy says exactly that. Vehicle
  // archiving is an open client requirement, not a rename of this action.
  const suspend = () => {
    startTransition(async () => {
      const result = await bulkUpdateVehicles(ids, { status: "suspended" });
      if (result.error) {
        toast.error(t("errors.save_failed"));
        return;
      }
      toast.success(t("bulkSuspended", { count: result.updated ?? ids.length }));
      refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <p className="text-[12px] font-semibold text-foreground">{t("bulkSelected", { count: rows.length })}</p>
      <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => setAssignOpen(true)}>
        {t("bulkAssign")}
      </Button>
      <Select
        value={status}
        onValueChange={(value) => {
          if (value === "active" || value === "suspended" || value === "maintenance") setStatus(value);
        }}
      >
        <SelectTrigger className="h-9 w-[160px]">
          <SelectValue placeholder={t("bulkStatus")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">{t("statusActive")}</SelectItem>
          <SelectItem value="suspended">{t("statusSuspended")}</SelectItem>
          <SelectItem value="maintenance">{t("statusMaintenance")}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" className="h-9" disabled={pending || !status} onClick={applyStatus}>
        {t("bulkApply")}
      </Button>
      <CompanyPick value={companyId} onChange={setCompanyId} disabled={pending} />
      <Button type="button" variant="outline" className="h-9" disabled={pending || !companyId} onClick={applyCompany}>
        {t("bulkCompany")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-9 text-destructive hover:bg-destructive/10"
        disabled={pending}
        onClick={suspend}
      >
        {t("bulkSuspend")}
      </Button>
      <VehicleBulkAssignDialog
        open={assignOpen}
        rows={rows}
        onOpenChange={setAssignOpen}
        onSaved={() => {
          setAssignOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

function CompanyPick({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
}) {
  const t = useTranslations("pages.vehicles");
  const partners = useQuery({
    queryKey: [...queryKeys.vehicles.all(), "bulk-partners"],
    queryFn: listVehiclePartners,
  });
  const items = useMemo(
    () => (partners.data ?? []).map((partner) => ({ value: partner.id, label: partner.name, keywords: [partner.name] })),
    [partners.data],
  );
  return (
    <div className="w-[220px]">
      <SearchSelect
        items={items}
        value={value}
        onChange={onChange}
        placeholder={t("bulkCompany")}
        searchPlaceholder={t("bulkCompany")}
        recentsKey="vehicle-bulk-company"
        disabled={disabled}
        className="h-9"
      />
    </div>
  );
}

function VehicleBulkAssignDialog({
  open,
  rows,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  rows: VehicleListRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("pages.vehicles");
  const [pending, startTransition] = useTransition();
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const drivers = useQuery({
    queryKey: [...queryKeys.vehicles.all(), "tab-drivers"],
    queryFn: listVehicleTabDrivers,
    enabled: open,
  });
  const driverItems = useMemo(
    () =>
      (drivers.data ?? []).map((item) => ({
        value: item.id,
        label: item.label,
        keywords: item.keywords,
      })),
    [drivers.data],
  );
  const projectByDriver = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const item of drivers.data ?? []) map.set(item.id, item.projectKey);
    return map;
  }, [drivers.data]);

  const save = () => {
    startTransition(async () => {
      const result = await bulkAssignVehicleDrivers(
        rows.map((row) => ({
          vehicleId: row.id,
          driverId: picks[row.id] === undefined ? row.assigned_driver_id : picks[row.id],
        })),
      );
      if (result.error) {
        toast.error(t("errors.save_failed"));
        return;
      }
      toast.success(t("bulkAssigned", { count: result.updated ?? rows.length }));
      onSaved();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(720px,96vw)] gap-0 p-0">
        <div className="max-h-[min(520px,60dvh)] space-y-3 overflow-auto px-5 py-4">
          <p className="text-[12px] text-muted-foreground">{t("bulkAssignHint")}</p>
          {rows.map((row) => {
            const driverId = picks[row.id] === undefined ? row.assigned_driver_id : picks[row.id];
            const project = driverId ? projectByDriver.get(driverId) ?? row.assigned_project_key : null;
            return (
              <div key={row.id} className="grid items-center gap-2 sm:grid-cols-[160px_1fr_auto]">
                <p className="truncate text-[13px] font-medium">{row.reg_number || row.bike_id}</p>
                <SearchSelect
                  items={driverItems}
                  value={driverId}
                  onChange={(next) => setPicks((prev) => ({ ...prev, [row.id]: next }))}
                  placeholder={t("assignDriverPlaceholder")}
                  searchPlaceholder={t("assignDriverPlaceholder")}
                  recentsKey="vehicle-assign-driver"
                  disabled={pending}
                  className="h-9"
                />
                {isDriverProjectKey(project) ? (
                  <span className="text-[11px] text-muted-foreground">
                    {t("bulkProject", { project })}
                    <ProjectBadge value={project} />
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">—</span>
                )}
              </div>
            );
          })}
        </div>
        <AppModalFooter title={t("bulkAssign")} subtitle={t("bulkAssignHint")}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" className="h-9" disabled={pending} onClick={save}>
            {t("bulkAssignSave")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
