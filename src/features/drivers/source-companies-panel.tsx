"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Eye, Lock, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AppFormSection } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SegmentOption, ToggleChip } from "@/components/app/toggle-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
import {
  companyKeyFromName,
  computeSourceCompanyIncentive,
  parseDpdTarget,
  parseRateKwd,
  validateSourceCompanyScheme,
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
  dpdTarget: string;
  incentiveEnabled: boolean;
  aboveKwd: string;
  belowKwd: string;
  effectiveFrom: string;
  logoFile: File | null;
  removeLogo: boolean;
};

const PREVIEW_ORDERS = [30, 21, 15, 10, 5, 0];

const toRateStr = (v: number | string | null | undefined): string =>
  v == null ? "" : String(v);

export function SourceCompaniesPanel({ companies }: { companies: SourceCompanyWithUsage[] }) {
  const t = useTranslations("pages.settings.sourceCompanies");
  const { can } = useAuth();
  const canCreate = can("companies.create");
  const canEdit = can("companies.edit");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<SourceCompanyWithUsage | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const openNew = () => {
    setLogoPreview(null);
    setDraft({
      key: "",
      name: "",
      clientCode: "",
      isActive: true,
      isNew: true,
      isSystem: false,
      driverCount: 0,
      dpdTarget: "",
      incentiveEnabled: false,
      aboveKwd: "",
      belowKwd: "",
      effectiveFrom: "",
      logoFile: null,
      removeLogo: false,
    });
  };

  const openEdit = (c: SourceCompanyWithUsage) => {
    setLogoPreview(c.logo_display_url ?? null);
    setDraft({
      key: c.key,
      name: c.name,
      clientCode: c.client_code ?? "",
      isActive: c.is_active,
      isNew: false,
      isSystem: c.is_system,
      driverCount: c.driver_count,
      dpdTarget: c.dpd_target != null ? String(c.dpd_target) : "",
      incentiveEnabled: c.incentive_enabled,
      aboveKwd: toRateStr(c.incentive_above_kwd),
      belowKwd: toRateStr(c.incentive_below_kwd),
      effectiveFrom: c.effective_from ?? "",
      logoFile: null,
      removeLogo: false,
    });
  };

  const pickLogo = (file: File | null) => {
    if (!draft) return;
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      toast.error(t("errors.logo_invalid_type"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("errors.logo_file_too_large"));
      return;
    }
    if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    setLogoPreview(URL.createObjectURL(file));
    setDraft({ ...draft, logoFile: file, removeLogo: false });
  };

  const clearLogo = () => {
    if (!draft) return;
    if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    setLogoPreview(null);
    setDraft({ ...draft, logoFile: null, removeLogo: true });
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const draftKey = draft ? (draft.isNew ? companyKeyFromName(draft.name) : draft.key) : "";

  const schemeError = useMemo(() => {
    if (!draft || draft.isSystem) return null;
    return validateSourceCompanyScheme({
      dpdTarget: draft.dpdTarget,
      incentiveEnabled: draft.incentiveEnabled,
      aboveKwd: draft.aboveKwd,
      belowKwd: draft.belowKwd,
      effectiveFrom: draft.effectiveFrom,
    });
  }, [draft]);

  const previewRows = useMemo(() => {
    if (!draft || !draft.incentiveEnabled || draft.isSystem) return [];
    const target = parseDpdTarget(draft.dpdTarget);
    const above = parseRateKwd(draft.aboveKwd);
    const below = parseRateKwd(draft.belowKwd);
    if (target == null || above == null || below == null) return [];
    return PREVIEW_ORDERS.map((orders) => ({
      orders,
      ...computeSourceCompanyIncentive(orders, target, above, below),
    }));
  }, [draft]);

  const save = () => {
    if (!draft) return;
    if (schemeError) {
      toast.error(t(`errors.${schemeError}`));
      return;
    }
    startTransition(async () => {
      const result = await upsertSourceCompany({
        key: draftKey,
        name: draft.name,
        clientCode: draft.clientCode,
        isActive: draft.isActive,
        isNew: draft.isNew,
        dpdTarget: parseDpdTarget(draft.dpdTarget),
        incentiveEnabled: draft.incentiveEnabled,
        incentiveAboveKwd: parseRateKwd(draft.aboveKwd),
        incentiveBelowKwd: parseRateKwd(draft.belowKwd),
        effectiveFrom: draft.effectiveFrom.trim() || null,
        logoFile: draft.logoFile,
        removeLogo: draft.removeLogo && !draft.logoFile,
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
        canCreate ? (
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
              <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colClientId")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDpd")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colDrivers")}</TableHead>
              <TableHead className={`${TABLE_HEAD_CLASS} w-24 text-end`}>{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((c) => (
              <TableRow
                key={c.key}
                onClick={() => setViewing(c)}
                className="cursor-pointer"
              >
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    {c.logo_display_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.logo_display_url}
                        alt=""
                        className="size-6 shrink-0 rounded border border-border bg-white object-contain"
                      />
                    ) : (
                      <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
                    )}
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
                  {c.is_system ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      —
                    </Badge>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      {c.dpd_target != null ? (
                        <Badge variant="outline" className="border-primary/20 bg-primary/10 font-mono text-primary">
                          {t("dpdBadge", { target: c.dpd_target })}
                        </Badge>
                      ) : null}
                      {c.incentive_enabled ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          {t("scheme")}
                        </Badge>
                      ) : null}
                      {!c.incentive_enabled && c.dpd_target == null ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          —
                        </Badge>
                      ) : null}
                    </span>
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
                  <span className="inline-flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-primary hover:bg-primary/10"
                      onClick={(event) => {
                        event.stopPropagation();
                        setViewing(c);
                      }}
                    >
                      <Eye className="size-3.5" aria-hidden />
                      {t("view")}
                    </Button>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-primary hover:bg-primary/10"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(c);
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        {t("edit")}
                      </Button>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent
          showCloseButton
          closeOutside
          className="flex h-[95dvh] max-h-[95dvh] w-[min(1200px,96vw)] max-w-[min(1200px,96vw)] flex-col overflow-visible p-0"
        >
          {draft ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="grid items-start gap-4 lg:grid-cols-2 lg:items-stretch">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                        {logoPreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logoPreview} alt="" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <Building2 className="size-5 text-muted-foreground" aria-hidden />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <Label htmlFor="source-company-logo">{t("logo")}</Label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => logoInputRef.current?.click()}
                          >
                            <Upload className="size-3.5" aria-hidden />
                            {logoPreview ? t("logoReplace") : t("logoUpload")}
                          </Button>
                          {logoPreview ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive hover:bg-destructive/10"
                              onClick={clearLogo}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                              {t("logoRemove")}
                            </Button>
                          ) : null}
                        </div>
                        <input
                          ref={logoInputRef}
                          id="source-company-logo"
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={(event) => pickLogo(event.target.files?.[0] ?? null)}
                        />
                        <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
                      </div>
                    </div>
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
                        <p className="text-xs text-muted-foreground">
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
                      <p className="text-xs text-muted-foreground">{t("clientIdHint")}</p>
                    </div>

                    {!draft.isSystem ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="source-company-dpd">{t("dpdTarget")}</Label>
                            <Input
                              id="source-company-dpd"
                              className="h-9 font-mono"
                              inputMode="numeric"
                              value={draft.dpdTarget}
                              placeholder={t("dpdTargetPlaceholder")}
                              onChange={(event) =>
                                setDraft({ ...draft, dpdTarget: event.target.value.replace(/\D/g, "") })
                              }
                            />
                            <p className="text-xs text-muted-foreground">{t("dpdTargetHint")}</p>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="source-company-effective">{t("effectiveFrom")}</Label>
                            <Input
                              id="source-company-effective"
                              type="date"
                              className="h-9"
                              openPickerOnFocus={false}
                              value={draft.effectiveFrom}
                              onChange={(event) =>
                                setDraft({ ...draft, effectiveFrom: event.target.value })
                              }
                            />
                            <p className="text-xs text-muted-foreground">{t("effectiveFromHint")}</p>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label>{t("incentiveScheme")}</Label>
                          <div className="flex items-center gap-2">
                            <ToggleChip
                              selected={draft.incentiveEnabled}
                              onClick={() =>
                                setDraft({ ...draft, incentiveEnabled: !draft.incentiveEnabled })
                              }
                            >
                              {t("incentiveSchemeOn")}
                            </ToggleChip>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("incentiveSchemeHint")}</p>
                        </div>

                        {draft.incentiveEnabled ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="source-company-above">{t("aboveKwd")}</Label>
                              <Input
                                id="source-company-above"
                                className="h-9 font-mono"
                                inputMode="decimal"
                                value={draft.aboveKwd}
                                placeholder="0.100"
                                onChange={(event) =>
                                  setDraft({ ...draft, aboveKwd: event.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="source-company-below">{t("belowKwd")}</Label>
                              <Input
                                id="source-company-below"
                                className="h-9 font-mono"
                                inputMode="decimal"
                                value={draft.belowKwd}
                                placeholder="0.350"
                                onChange={(event) =>
                                  setDraft({ ...draft, belowKwd: event.target.value })
                                }
                              />
                            </div>
                          </div>
                        ) : null}

                        <p className="text-xs text-muted-foreground">{t("companyConfigNote")}</p>
                      </>
                    ) : null}

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
                        <p className="text-xs text-muted-foreground">
                          {t("inUseHint", { count: draft.driverCount })}
                        </p>
                      ) : null}
                      {draft.isSystem ? (
                        <p className="text-xs text-muted-foreground">{t("systemHint")}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
                    {previewRows.length > 0 ? (
                      <div className="overflow-hidden rounded-lg border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className={TABLE_HEAD_CLASS}>{t("previewOrders")}</TableHead>
                              <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>
                                {t("previewIncentive")}
                              </TableHead>
                              <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>
                                {t("previewDeduction")}
                              </TableHead>
                              <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>
                                {t("previewNet")}
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewRows.map((row) => (
                              <TableRow key={row.orders}>
                                <TableCell className="font-mono text-xs tabular-nums">
                                  {row.orders}
                                </TableCell>
                                <TableCell className="text-end font-mono text-xs tabular-nums text-emerald-700">
                                  {row.incentiveKwd.toFixed(3)}
                                </TableCell>
                                <TableCell className="text-end font-mono text-xs tabular-nums text-destructive">
                                  {row.deductionKwd.toFixed(3)}
                                </TableCell>
                                <TableCell
                                  className={`text-end font-mono text-xs tabular-nums ${
                                    row.netKwd < 0 ? "text-destructive" : "text-emerald-700"
                                  }`}
                                >
                                  {row.netKwd.toFixed(3)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {draft.isSystem ? t("systemHint") : t("incentiveSchemeHint")}
                      </p>
                    )}
                  </div>
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
                  disabled={
                    pending ||
                    draft.isSystem ||
                    !draft.name.trim() ||
                    !draftKey ||
                    schemeError !== null
                  }
                >
                  {t("save")}
                </Button>
              </AppModalFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => (open ? null : setViewing(null))}>
        <DialogContent
          showCloseButton
          closeOutside
          className="flex w-[min(720px,96vw)] max-w-[min(720px,96vw)] flex-col overflow-visible p-0"
        >
          {viewing ? (
            <>
              <div className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  {viewing.logo_display_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={viewing.logo_display_url}
                      alt=""
                      className="size-9 shrink-0 rounded border border-border bg-white object-contain p-0.5"
                    />
                  ) : (
                    <Building2 className="size-4 text-muted-foreground" aria-hidden />
                  )}
                  <DialogTitle className="text-base font-semibold">{viewing.name}</DialogTitle>
                  {viewing.is_system ? (
                    <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                      {t("system")}
                    </Badge>
                  ) : null}
                  {viewing.is_active ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      {t("active")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t("inactive")}
                    </Badge>
                  )}
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  {t("keyHint", { key: viewing.key })}
                </DialogDescription>

                <dl className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-xs text-muted-foreground">{t("colClientId")}</dt>
                    <dd className="mt-1 font-mono text-sm">
                      {viewing.client_code ? (
                        viewing.client_code
                      ) : (
                        <span className="text-muted-foreground">{t("notSet")}</span>
                      )}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-xs text-muted-foreground">{t("colDrivers")}</dt>
                    <dd className="mt-1 text-sm tabular-nums">{viewing.driver_count}</dd>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-xs text-muted-foreground">{t("dpdTarget")}</dt>
                    <dd className="mt-1 text-sm tabular-nums">
                      {viewing.dpd_target != null ? (
                        <Badge variant="outline" className="border-primary/20 bg-primary/10 font-mono text-primary">
                          {t("dpdBadge", { target: viewing.dpd_target })}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">{t("notSet")}</span>
                      )}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-xs text-muted-foreground">{t("incentiveScheme")}</dt>
                    <dd className="mt-1 text-sm">
                      {viewing.incentive_enabled ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          {t("incentiveSchemeOn")}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">{t("inactive")}</span>
                      )}
                    </dd>
                  </div>
                  {viewing.incentive_enabled ? (
                    <>
                      <div className="rounded-lg border border-border bg-card p-3">
                        <dt className="text-xs text-muted-foreground">{t("aboveKwd")}</dt>
                        <dd className="mt-1 font-mono text-sm tabular-nums text-emerald-700">
                          {viewing.incentive_above_kwd != null
                            ? viewing.incentive_above_kwd.toFixed(3)
                            : "—"}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-3">
                        <dt className="text-xs text-muted-foreground">{t("belowKwd")}</dt>
                        <dd className="mt-1 font-mono text-sm tabular-nums text-destructive">
                          {viewing.incentive_below_kwd != null
                            ? viewing.incentive_below_kwd.toFixed(3)
                            : "—"}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-3 sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">{t("effectiveFrom")}</dt>
                        <dd className="mt-1 text-sm tabular-nums">
                          {viewing.effective_from ?? (
                            <span className="text-muted-foreground">{t("notSet")}</span>
                          )}
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>

                <p className="text-xs text-muted-foreground">{t("companyConfigNote")}</p>
              </div>

              <AppModalFooter title={t("viewTitle")} subtitle={viewing.name}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => setViewing(null)}
                >
                  {t("close")}
                </Button>
                {canEdit ? (
                  <Button
                    type="button"
                    className="h-9"
                    onClick={() => {
                      const target = viewing;
                      setViewing(null);
                      openEdit(target);
                    }}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    {t("edit")}
                  </Button>
                ) : null}
              </AppModalFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppFormSection>
  );
}
