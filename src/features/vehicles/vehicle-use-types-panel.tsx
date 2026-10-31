"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, Lock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AppFormSection } from "@/components/app";
import { AppDataTable, AppDataTableRow, TableCell } from "@/components/app/app-data-table";
import { groupHeaderProps, groupRows, GroupTableHeaderRow, useGroupedListView } from "@/components/app/app-list-controls";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { EmptyCell, TableNameCell, TableToolbar, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { useTypeKeyFromLabel, type VehicleUseTypeWithUsage } from "./vehicle-use-types";
import { upsertVehicleUseType } from "./vehicle-use-types-actions";

type Draft = {
  key: string;
  labelEn: string;
  labelAr: string;
  isActive: boolean;
  isNew: boolean;
  isSystem: boolean;
  vehicleCount: number;
};

export function VehicleUseTypesPanel({ types }: { types: VehicleUseTypeWithUsage[] }) {
  const t = useTranslations("pages.settings.vehicleUses");
  const { can } = useAuth();
  // Cannot be `settings.manage`: this panel is reached from OperationsHub, which
  // an operations user opens with `vehicles.manage` alone.
  const canManage = can("vehicles.manage");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  const openNew = () =>
    setDraft({
      key: "",
      labelEn: "",
      labelAr: "",
      isActive: true,
      isNew: true,
      isSystem: false,
      vehicleCount: 0,
    });

  const openEdit = (item: VehicleUseTypeWithUsage) =>
    setDraft({
      key: item.key,
      labelEn: item.label_en,
      labelAr: item.label_ar,
      isActive: item.is_active,
      isNew: false,
      isSystem: item.is_system,
      vehicleCount: item.vehicle_count,
    });

  const draftKey = draft ? (draft.isNew ? useTypeKeyFromLabel(draft.labelEn) : draft.key) : "";

  const save = () => {
    if (!draft) return;
    startTransition(async () => {
      const result = await upsertVehicleUseType({
        key: draftKey,
        labelEn: draft.labelEn,
        labelAr: draft.labelAr,
        isActive: draft.isActive,
        isNew: draft.isNew,
      });
      if ("error" in result) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("saved"));
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
      router.refresh();
    });
  };

  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "name", label: t("colLabelEn"), locked: true },
      { id: "labelAr", label: t("colLabelAr") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "vehicles", label: t("colVehicles") },
      { id: "actions", label: t("colActions"), locked: true },
    ],
    [t],
  );
  const prefs = useTablePrefs("vehicle-use-types", columns);
  const filtered = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    if (!query) return types;
    return types.filter((item) =>
      [item.label_en, item.label_ar, item.is_active ? t("active") : t("inactive"), String(item.vehicle_count)]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [prefs.appliedQuery, t, types]);
  const grouped = prefs.groupBy !== "none";
  const sections = useMemo(
    () =>
      groupRows(filtered, grouped ? prefs.groupBy : "none", {
        status: (item) => (item.is_active ? t("active") : t("inactive")),
      }),
    [filtered, grouped, prefs.groupBy, t],
  );
  const view = useGroupedListView(sections, grouped, prefs.groupBy);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  return (
    <AppFormSection title={t("title")} description={t("subtitle")}>
      <AppDataTable
        toolbar={
          <TableToolbar
            prefs={prefs}
            entity={t("title")}
            columns={columns}
            rowKind="dynamic"
            filteredCount={filtered.length}
            totalCount={types.length}
            onAdd={canManage ? openNew : undefined}
            addLabel={t("add")}
          />
        }
        columns={shown.map((column) => ({
          id: column.id,
          label: column.label,
          className: column.id === "vehicles" || column.id === "actions" ? "text-end" : undefined,
        }))}
      >
        {view.sections.flatMap((section) => {
          const header = grouped ? (
            <GroupTableHeaderRow
              key={`${section.key}-header`}
              colSpan={Math.max(shown.length, 1)}
              {...groupHeaderProps(section)}
              onToggle={() => view.toggle(section.key)}
              onStep={(dir) => view.step(section.key, dir)}
            />
          ) : null;
          const body = section.visibleRows.map((item) => (
            <AppDataTableRow key={item.key}>
              {shown.map((column) => {
                if (!isUseColumn(column.id)) return null;
                return (
                  <TableCell
                    key={column.id}
                    className={column.id === "vehicles" || column.id === "actions" ? "text-end" : undefined}
                  >
                    {useCell(column.id, item, {
                      active: t("active"),
                      inactive: t("inactive"),
                      system: t("system"),
                      edit: t("edit"),
                      canManage,
                      onEdit: () => openEdit(item),
                    })}
                  </TableCell>
                );
              })}
            </AppDataTableRow>
          ));
          return header ? [header, ...body] : body;
        })}
      </AppDataTable>

      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent showCloseButton closeOutside className="w-[min(560px,96vw)] overflow-visible p-0">
          {draft ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <div className="space-y-3 px-5 py-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vehicle-use-en">
                    {t("colLabelEn")}
                    <span className="text-destructive" aria-hidden>
                      {" "}
                      *
                    </span>
                  </Label>
                  <Input
                    id="vehicle-use-en"
                    className="h-9"
                    value={draft.labelEn}
                    maxLength={80}
                    onChange={(event) => setDraft({ ...draft, labelEn: event.target.value })}
                  />
                  {draft.isNew && draftKey ? (
                    <p className="text-xs text-muted-foreground">{t("keyHint", { key: draftKey })}</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vehicle-use-ar">{t("colLabelAr")}</Label>
                  <Input
                    id="vehicle-use-ar"
                    className="h-9"
                    value={draft.labelAr}
                    maxLength={80}
                    onChange={(event) => setDraft({ ...draft, labelAr: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("colStatus")}</Label>
                  <div role="radiogroup" className="grid grid-cols-2 gap-1.5">
                    <SegmentOption
                      selected={draft.isActive}
                      variant={draft.isActive ? "success" : "default"}
                      onClick={() => setDraft({ ...draft, isActive: true })}
                    >
                      {t("active")}
                    </SegmentOption>
                    <SegmentOption
                      selected={!draft.isActive}
                      onClick={() => setDraft({ ...draft, isActive: false })}
                    >
                      {t("inactive")}
                    </SegmentOption>
                  </div>
                  {!draft.isNew && draft.vehicleCount > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("inUseHint", { count: draft.vehicleCount })}
                    </p>
                  ) : null}
                  {draft.isSystem ? (
                    <p className="text-xs text-muted-foreground">{t("systemHint")}</p>
                  ) : null}
                </div>
              </div>
              <AppModalFooter
                title={draft.isNew ? t("addTitle") : t("editTitle")}
                subtitle={t("modalSubtitle")}
              >
                <Button type="button" variant="outline" className="h-9" onClick={() => setDraft(null)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" className="h-9" disabled={pending || !draft.labelEn.trim() || !draftKey}>
                  {t("save")}
                </Button>
              </AppModalFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppFormSection>
  );
}

const USE_COLUMN_IDS = ["name", "labelAr", "status", "vehicles", "actions"] as const;
type UseColumnId = (typeof USE_COLUMN_IDS)[number];

function isUseColumn(id: string): id is UseColumnId {
  return (USE_COLUMN_IDS as readonly string[]).includes(id);
}

function useCell(
  id: UseColumnId,
  item: VehicleUseTypeWithUsage,
  labels: {
    active: string;
    inactive: string;
    system: string;
    edit: string;
    canManage: boolean;
    onEdit: () => void;
  },
): ReactNode {
  switch (id) {
    case "name":
      return (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Car className="size-3.5 text-muted-foreground" aria-hidden />
          <TableNameCell name={item.label_en} />
          {item.is_system ? <Lock className="size-3 text-muted-foreground" aria-label={labels.system} /> : null}
        </span>
      );
    case "labelAr":
      return item.label_ar ? item.label_ar : <EmptyCell />;
    case "status":
      return item.is_active ? (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          {labels.active}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          {labels.inactive}
        </Badge>
      );
    case "vehicles":
      return <span className="tabular-nums">{item.vehicle_count}</span>;
    case "actions":
      return labels.canManage ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-primary hover:bg-primary/10"
          onClick={labels.onEdit}
        >
          <Pencil className="size-3.5" aria-hidden />
          {labels.edit}
        </Button>
      ) : null;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
