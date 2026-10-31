"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, ExternalLink, Pencil } from "lucide-react";
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
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import {
  companyKeyFromLabel,
  type VehicleCompanyWithUsage,
} from "./vehicle-companies";
import { upsertVehicleCompany } from "./vehicle-companies-actions";

type Draft = {
  key: string;
  labelEn: string;
  labelAr: string;
  isActive: boolean;
  isNew: boolean;
  vehicleCount: number;
};

export function VehicleCompaniesPanel({ companies }: { companies: VehicleCompanyWithUsage[] }) {
  const t = useTranslations("pages.vehicles.companies");
  const { can } = useAuth();
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
      vehicleCount: 0,
    });

  const openEdit = (item: VehicleCompanyWithUsage) =>
    setDraft({
      key: item.key,
      labelEn: item.label_en,
      labelAr: item.label_ar,
      isActive: item.is_active,
      isNew: false,
      vehicleCount: item.vehicle_count,
    });

  const draftKey = draft ? (draft.isNew ? companyKeyFromLabel(draft.labelEn) : draft.key) : "";

  const save = () => {
    if (!draft) return;
    startTransition(async () => {
      const result = await upsertVehicleCompany({
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

  const activeCount = companies.filter((item) => item.is_active).length;
  const assignedVehicles = companies.reduce((sum, item) => sum + item.vehicle_count, 0);
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
  const prefs = useTablePrefs("vehicle-companies", columns);
  const filtered = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    if (!query) return companies;
    return companies.filter((item) =>
      [item.label_en, item.label_ar, item.is_active ? t("active") : t("inactive"), String(item.vehicle_count)]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [companies, prefs.appliedQuery, t]);
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
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {[
          { label: t("kpiTotal"), value: companies.length },
          { label: t("kpiActive"), value: activeCount },
          { label: t("kpiVehicles"), value: assignedVehicles },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="text-lg font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>
      <AppDataTable
        toolbar={
          <TableToolbar
            prefs={prefs}
            entity={t("title")}
            columns={columns}
            rowKind="dynamic"
            filteredCount={filtered.length}
            totalCount={companies.length}
            onAdd={canManage ? openNew : undefined}
            addLabel={t("add")}
          />
        }
        columns={shown.map((column) => ({
          id: column.id,
          label: column.label,
          className: column.id === "vehicles" || column.id === "actions" ? "text-end" : undefined,
        }))}
        empty={filtered.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p> : undefined}
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
                if (!isCompanyColumn(column.id)) return null;
                return (
                  <TableCell
                    key={column.id}
                    className={column.id === "vehicles" || column.id === "actions" ? "text-end" : undefined}
                  >
                    {companyCell(column.id, item, {
                      active: t("active"),
                      inactive: t("inactive"),
                      viewVehicles: t("viewVehicles"),
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
                  <Label htmlFor="vehicle-company-en">
                    {t("colLabelEn")}
                    <span className="text-destructive" aria-hidden>
                      {" "}
                      *
                    </span>
                  </Label>
                  <Input
                    id="vehicle-company-en"
                    className="h-9"
                    value={draft.labelEn}
                    maxLength={80}
                    onChange={(event) => setDraft({ ...draft, labelEn: event.target.value })}
                  />
                  {draft.isNew && draftKey ? (
                    <p className="text-xs text-muted-foreground">
                      {t("keyHint", { key: draftKey })}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vehicle-company-ar">{t("colLabelAr")}</Label>
                  <Input
                    id="vehicle-company-ar"
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
                  {!draft.isNew && !draft.isActive && draft.vehicleCount > 0 ? (
                    <p className="text-xs text-amber-700">
                      {t("deactivateHint", { count: draft.vehicleCount })}
                    </p>
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
                <Button
                  type="submit"
                  className="h-9"
                  disabled={pending || !draft.labelEn.trim() || !draftKey}
                >
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

const COMPANY_COLUMN_IDS = ["name", "labelAr", "status", "vehicles", "actions"] as const;
type CompanyColumnId = (typeof COMPANY_COLUMN_IDS)[number];

function isCompanyColumn(id: string): id is CompanyColumnId {
  return (COMPANY_COLUMN_IDS as readonly string[]).includes(id);
}

function companyCell(
  id: CompanyColumnId,
  item: VehicleCompanyWithUsage,
  labels: {
    active: string;
    inactive: string;
    viewVehicles: string;
    edit: string;
    canManage: boolean;
    onEdit: () => void;
  },
): ReactNode {
  switch (id) {
    case "name":
      return (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
          <TableNameCell name={item.label_en} />
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
      return (
        <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
          {item.vehicle_count}
          {item.vehicle_count > 0 ? (
            <Link
              href={`/vehicles?company=${encodeURIComponent(item.key)}`}
              className="inline-flex items-center gap-0.5 text-xs text-primary hover:bg-primary/10"
            >
              {labels.viewVehicles}
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          ) : null}
        </span>
      );
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
