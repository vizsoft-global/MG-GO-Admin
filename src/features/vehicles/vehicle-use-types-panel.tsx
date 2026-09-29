"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, Lock, Pencil, Plus } from "lucide-react";
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
  const canManage = can("settings.manage");
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
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelEn")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelAr")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colVehicles")}</TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} w-24 text-end`}>{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((item) => (
              <TableRow key={item.key}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Car className="size-3.5 text-muted-foreground" aria-hidden />
                    {item.label_en}
                    {item.is_system ? (
                      <Lock className="size-3 text-muted-foreground" aria-label={t("system")} />
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>{item.label_ar}</TableCell>
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
                <TableCell className="text-end tabular-nums">{item.vehicle_count}</TableCell>
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
            ))}
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
                    <p className="text-[10px] text-muted-foreground">{t("keyHint", { key: draftKey })}</p>
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
                    <p className="text-[10px] text-muted-foreground">
                      {t("inUseHint", { count: draft.vehicleCount })}
                    </p>
                  ) : null}
                  {draft.isSystem ? (
                    <p className="text-[10px] text-muted-foreground">{t("systemHint")}</p>
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
