"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Lock, Pencil, Plus } from "lucide-react";
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
import { queryKeys } from "@/lib/query/query-keys";
import {
  companyKeyFromName,
  type SourceCompanyWithUsage,
} from "./source-companies";
import { upsertSourceCompany } from "./source-companies-actions";

type Draft = {
  key: string;
  name: string;
  clientCode: string;
  isActive: boolean;
  isNew: boolean;
  isSystem: boolean;
  driverCount: number;
};

export function SourceCompaniesPanel({ companies }: { companies: SourceCompanyWithUsage[] }) {
  const t = useTranslations("pages.settings.sourceCompanies");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  const openNew = () =>
    setDraft({
      key: "",
      name: "",
      clientCode: "",
      isActive: true,
      isNew: true,
      isSystem: false,
      driverCount: 0,
    });

  const openEdit = (c: SourceCompanyWithUsage) =>
    setDraft({
      key: c.key,
      name: c.name,
      clientCode: c.client_code ?? "",
      isActive: c.is_active,
      isNew: false,
      isSystem: c.is_system,
      driverCount: c.driver_count,
    });

  const draftKey = draft ? (draft.isNew ? companyKeyFromName(draft.name) : draft.key) : "";

  const save = () => {
    if (!draft) return;
    startTransition(async () => {
      const result = await upsertSourceCompany({
        key: draftKey,
        name: draft.name,
        clientCode: draft.clientCode,
        isActive: draft.isActive,
        isNew: draft.isNew,
      });
      if ("error" in result) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("saved"));
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sourceCompanies.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.drivers.all() });
      router.refresh();
    });
  };

  return (
    <AppFormSection
      title={t("title")}
      description={t("subtitle")}
      action={
        <Button type="button" className="h-9" onClick={openNew}>
          <Plus className="size-4" aria-hidden />
          {t("add")}
        </Button>
      }
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colClientId")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colDrivers")}</TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} w-24 text-end`}>{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((c) => (
              <TableRow key={c.key}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
                    {c.name}
                    {c.is_system ? (
                      <Lock className="size-3 text-muted-foreground" aria-label={t("system")} />
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  {c.client_code ? (
                    <Badge variant="outline" className="border-primary/20 bg-primary/10 font-mono text-primary">
                      {c.client_code}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">
                      {t("notSet")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {c.is_active ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      {t("active")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t("inactive")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums">{c.driver_count}</TableCell>
                <TableCell className="text-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-primary hover:bg-primary/10"
                    onClick={() => openEdit(c)}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    {t("edit")}
                  </Button>
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
                  <Label htmlFor="source-company-name">
                    {t("colName")}
                    <span className="text-destructive" aria-hidden>
                      {" "}
                      *
                    </span>
                  </Label>
                  <Input
                    id="source-company-name"
                    className="h-9"
                    value={draft.name}
                    maxLength={120}
                    disabled={draft.isSystem}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                  {draft.isNew && draftKey ? (
                    <p className="text-[10px] text-muted-foreground">
                      {t("keyHint", { key: draftKey })}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source-company-code">{t("colClientId")}</Label>
                  <Input
                    id="source-company-code"
                    className="h-9 font-mono uppercase"
                    value={draft.clientCode}
                    maxLength={32}
                    placeholder="CL-0002"
                    disabled={draft.isSystem}
                    onChange={(event) =>
                      setDraft({ ...draft, clientCode: event.target.value.toUpperCase() })
                    }
                  />
                  <p className="text-[10px] text-muted-foreground">{t("clientIdHint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("colStatus")}</Label>
                  <div role="radiogroup" className="grid grid-cols-2 gap-1.5">
                    <SegmentOption
                      selected={draft.isActive}
                      variant={draft.isActive ? "success" : "default"}
                      disabled={draft.isSystem}
                      onClick={() => setDraft({ ...draft, isActive: true })}
                    >
                      {t("active")}
                    </SegmentOption>
                    <SegmentOption
                      selected={!draft.isActive}
                      disabled={draft.isSystem}
                      onClick={() => setDraft({ ...draft, isActive: false })}
                    >
                      {t("inactive")}
                    </SegmentOption>
                  </div>
                  {!draft.isNew && draft.driverCount > 0 ? (
                    <p className="text-[10px] text-muted-foreground">
                      {t("inUseHint", { count: draft.driverCount })}
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
                <Button
                  type="submit"
                  className="h-9"
                  disabled={pending || draft.isSystem || !draft.name.trim() || !draftKey}
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
