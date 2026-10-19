"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, ExternalLink, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AppFormSection } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  return (
    <AppFormSection
      title={t("title")}
      description={t("subtitle")}
      action={
        canManage ? (
          <Button type="button" className="h-9" onClick={openNew}>
            <Plus className="size-4" aria-hidden />
            {t("add")}
          </Button>
        ) : undefined
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {[
          { label: t("kpiTotal"), value: companies.length },
          { label: t("kpiActive"), value: activeCount },
          { label: t("kpiVehicles"), value: assignedVehicles },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="text-lg font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelEn")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelAr")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colVehicles")}</TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} w-28 text-end`}>{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              companies.map((item) => (
                <TableRow key={item.key}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
                      {item.label_en}
                    </span>
                  </TableCell>
                  <TableCell>{item.label_ar || "—"}</TableCell>
                  <TableCell>
                    {item.is_active ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        {t("active")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        {t("inactive")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
                      {item.vehicle_count}
                      {item.vehicle_count > 0 ? (
                        <Link
                          href={`/vehicles?company=${encodeURIComponent(item.key)}`}
                          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:bg-primary/10"
                        >
                          {t("viewVehicles")}
                          <ExternalLink className="size-3" aria-hidden />
                        </Link>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-end">
                    {canManage ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-primary hover:bg-primary/10"
                        onClick={() => openEdit(item)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        {t("edit")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
                    <p className="text-[10px] text-muted-foreground">
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
                    <p className="text-[10px] text-amber-700">
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
