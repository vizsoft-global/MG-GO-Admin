"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PayrollClientRow } from "./payroll-clients";
import { PAYROLL_RULE_KINDS } from "./payroll-clients";
import { useDeletePayrollClient, usePayrollClients, useUpsertPayrollClient } from "./use-payroll-clients";

type Draft = {
  key: string | null;
  name: string;
  nameAr: string;
  isActive: boolean;
  usesHours: boolean;
  usesZone: boolean;
  usesOrders: boolean;
  fullDayHours: string;
  halfDayHours: string;
  reducedHours: string;
  requiredHoursPerDay: string;
  defaultOffDays: string;
  goodThreshold: string;
  averageThreshold: string;
  defaultResultKind: string;
  sortOrder: string;
  riderCount: number;
};

const EMPTY_DRAFT: Draft = {
  key: null,
  name: "",
  nameAr: "",
  isActive: true,
  usesHours: false,
  usesZone: true,
  usesOrders: true,
  fullDayHours: "12",
  halfDayHours: "6",
  reducedHours: "3",
  requiredHoursPerDay: "12",
  defaultOffDays: "2",
  goodThreshold: "110",
  averageThreshold: "70",
  defaultResultKind: "12",
  sortOrder: "100",
  riderCount: 0,
};

/**
 * One numeric control in the client dialog's payroll-rules block. Kept as a
 * component so the seven figures cannot drift in height or labelling.
 */
function NumberField({
  id,
  label,
  value,
  onChange,
  step = "1",
  min = 0,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  step?: string;
  min?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        step={step}
        className="h-9"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/**
 * The client catalog: the Employee Client dropdown, the HR Payroll Client Name
 * cell and Attendance & Orders all read `payroll_clients`, so this page is the
 * one place a client is added.
 *
 * The key is the document id and is derived from the English name on create; an
 * edit can change the labels, the day shape and the active flag, never the key —
 * every rider's `project_key` points at it.
 */
export function PayrollClientsPanel({
  rows: rowsProp,
  title,
  subtitle,
  showActions = true,
}: {
  /** Server-rendered on `/settings/payroll-clients`; Employee Settings omits it. */
  rows?: PayrollClientRow[];
  title: string;
  subtitle: string;
  /** Employee Settings hides the Actions column; the catalog page keeps it. */
  showActions?: boolean;
}) {
  const columnCount = showActions ? 7 : 6;
  const t = useTranslations("pages.settings.payrollClients");
  const router = useRouter();
  const liveClients = usePayrollClients();
  const rows = rowsProp ?? liveClients.data ?? [];
  const upsert = useUpsertPayrollClient();
  const remove = useDeletePayrollClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<PayrollClientRow | null>(null);

  const startAdd = () => {
    setDraft(EMPTY_DRAFT);
    setOpen(true);
  };

  const startEdit = (row: PayrollClientRow) => {
    setDraft({
      key: row.key,
      name: row.name,
      nameAr: row.nameAr,
      isActive: row.isActive,
      usesHours: row.usesHours,
      usesZone: row.usesZone,
      usesOrders: row.usesOrders,
      fullDayHours: String(row.fullDayHours),
      halfDayHours: String(row.halfDayHours),
      reducedHours: String(row.reducedHours),
      requiredHoursPerDay: String(row.requiredHoursPerDay),
      defaultOffDays: String(row.defaultOffDays),
      goodThreshold: String(row.goodThreshold),
      averageThreshold: String(row.averageThreshold),
      defaultResultKind: row.defaultResultKind ?? "12",
      sortOrder: String(row.sortOrder),
      riderCount: row.riderCount,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error(t("errors.invalid_name"));
      return;
    }
    const result = await upsert.mutateAsync({
      key: draft.key,
      name: draft.name,
      nameAr: draft.nameAr,
      isActive: draft.isActive,
      usesHours: draft.usesHours,
      usesZone: draft.usesZone,
      usesOrders: draft.usesOrders,
      fullDayHours: Number(draft.fullDayHours) || 12,
      halfDayHours: Number(draft.halfDayHours) || 6,
      reducedHours: Number(draft.reducedHours) || 3,
      requiredHoursPerDay: Number(draft.requiredHoursPerDay) || 12,
      defaultOffDays: Number.isFinite(Number(draft.defaultOffDays))
        ? Number(draft.defaultOffDays)
        : 2,
      goodThreshold: Number(draft.goodThreshold) || 110,
      averageThreshold: Number(draft.averageThreshold) || 70,
      defaultResultKind: draft.defaultResultKind,
      sortOrder: Number(draft.sortOrder) || 100,
    });
    if ("error" in result) {
      toast.error(t(`errors.${result.error}`));
      return;
    }
    toast.success(t("saved"));
    setOpen(false);
    router.refresh();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const result = await remove.mutateAsync(deleteTarget.key);
    setDeleteTarget(null);
    if ("error" in result) {
      toast.error(t(`errors.${result.error}`));
      return;
    }
    toast.success(t("deleted"));
    router.refresh();
  };

  return (
    <AppPage>
      <AppPageHeader
        title={title}
        description={subtitle}
        actions={
          <Button type="button" className="h-9" onClick={startAdd}>
            <Plus className="h-4 w-4" />
            {t("add")}
          </Button>
        }
      />
      <AppListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colKey")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colNameAr")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDayShape")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colRiders")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
              {showActions ? (
                <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colActions")}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                  <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key} className="cursor-pointer" onClick={() => startEdit(row)}>
                  <TableCell className="font-mono text-xs">{row.key}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell dir="rtl">{row.nameAr || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.usesHours
                      ? t("dayShapeHours", { hours: row.fullDayHours })
                      : t("dayShapeOrders")}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.riderCount}</TableCell>
                  <TableCell>
                    <span
                      className={
                        row.isActive
                          ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                          : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                      }
                    >
                      {row.isActive ? t("active") : t("inactive")}
                    </span>
                    {row.isSystem ? (
                      <span className="ms-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t("system")}
                      </span>
                    ) : null}
                  </TableCell>
                  {showActions ? (
                    <TableCell className="text-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        disabled={row.isSystem || row.riderCount > 0}
                        title={
                          row.isSystem
                            ? t("errors.system_client")
                            : row.riderCount > 0
                              ? t("errors.client_has_riders")
                              : t("delete")
                        }
                        aria-label={t("delete")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(row);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AppListCard>
      {renderEditor()}
      {showActions ? renderDelete() : null}
    </AppPage>
  );


  function renderEditor() {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton closeOutside className="w-[min(620px,96vw)]">
          <div className="max-h-[min(72dvh,680px)] space-y-4 overflow-y-auto p-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="payroll-client-name">{t("colName")}</Label>
                <Input
                  id="payroll-client-name"
                  className="h-9"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="payroll-client-name-ar">{t("colNameAr")}</Label>
                <Input
                  id="payroll-client-name-ar"
                  dir="rtl"
                  className="h-9"
                  value={draft.nameAr}
                  onChange={(event) => setDraft({ ...draft, nameAr: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payroll-client-key">{t("colKey")}</Label>
                <Input
                  id="payroll-client-key"
                  className="h-9 font-mono"
                  value={draft.key ?? ""}
                  disabled
                  placeholder={t("keyAuto")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payroll-client-hours">{t("fullDayHours")}</Label>
                <Input
                  id="payroll-client-hours"
                  type="number"
                  min={1}
                  max={24}
                  step="0.5"
                  className="h-9"
                  value={draft.fullDayHours}
                  onChange={(event) => setDraft({ ...draft, fullDayHours: event.target.value })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="payroll-client-hours-mode">{t("usesHours")}</Label>
                  <p className="text-xs text-muted-foreground">{t("usesHoursHint")}</p>
                </div>
                <Switch
                  id="payroll-client-hours-mode"
                  checked={draft.usesHours}
                  onCheckedChange={(checked) => setDraft({ ...draft, usesHours: checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="payroll-client-active">{t("active")}</Label>
                  <p className="text-xs text-muted-foreground">{t("activeHint")}</p>
                </div>
                <Switch
                  id="payroll-client-active"
                  checked={draft.isActive}
                  onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
                />
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {t("rulesHeading")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  id="payroll-client-half"
                  label={t("halfDayHours")}
                  value={draft.halfDayHours}
                  step="0.5"
                  onChange={(next) => setDraft({ ...draft, halfDayHours: next })}
                />
                <NumberField
                  id="payroll-client-reduced"
                  label={t("reducedHours")}
                  value={draft.reducedHours}
                  step="0.5"
                  onChange={(next) => setDraft({ ...draft, reducedHours: next })}
                />
                <NumberField
                  id="payroll-client-required"
                  label={t("requiredHoursPerDay")}
                  value={draft.requiredHoursPerDay}
                  step="0.5"
                  onChange={(next) => setDraft({ ...draft, requiredHoursPerDay: next })}
                />
                <NumberField
                  id="payroll-client-off-days"
                  label={t("defaultOffDays")}
                  value={draft.defaultOffDays}
                  onChange={(next) => setDraft({ ...draft, defaultOffDays: next })}
                />
                <NumberField
                  id="payroll-client-good"
                  label={t("goodThreshold")}
                  value={draft.goodThreshold}
                  onChange={(next) => setDraft({ ...draft, goodThreshold: next })}
                />
                <NumberField
                  id="payroll-client-average"
                  label={t("averageThreshold")}
                  value={draft.averageThreshold}
                  onChange={(next) => setDraft({ ...draft, averageThreshold: next })}
                />
                <NumberField
                  id="payroll-client-sort"
                  label={t("sortOrder")}
                  value={draft.sortOrder}
                  onChange={(next) => setDraft({ ...draft, sortOrder: next })}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-client-default-result">{t("defaultResult")}</Label>
                  <Select
                    items={PAYROLL_RULE_KINDS.map((kind) => ({ value: kind, label: kind }))}
                    value={draft.defaultResultKind}
                    onValueChange={(kind) => {
                      if (kind) setDraft({ ...draft, defaultResultKind: kind });
                    }}
                  >
                    <SelectTrigger id="payroll-client-default-result" className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYROLL_RULE_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {kind}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <Label htmlFor="payroll-client-uses-zone">{t("usesZone")}</Label>
                  <Switch
                    id="payroll-client-uses-zone"
                    checked={draft.usesZone}
                    onCheckedChange={(checked) => setDraft({ ...draft, usesZone: checked })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <Label htmlFor="payroll-client-uses-orders">{t("usesOrders")}</Label>
                  <Switch
                    id="payroll-client-uses-orders"
                    checked={draft.usesOrders}
                    onCheckedChange={(checked) => setDraft({ ...draft, usesOrders: checked })}
                  />
                </div>
              </div>
            </div>
            {draft.key && draft.riderCount > 0 && !draft.isActive ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {t("deactivateWarning", { count: draft.riderCount })}
              </p>
            ) : null}
          </div>
          <AppModalFooter title={draft.key ? t("edit") : t("add")} subtitle={title}>
            <Button type="button" variant="outline" className="h-9" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={upsert.isPending}
              onClick={() => void save()}
            >
              {t("save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    );
  }

  function renderDelete() {
    return (
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <DialogContent showCloseButton closeOutside className="w-[min(460px,96vw)]">
          <p className="px-1 pt-2 text-sm text-foreground">
            {t("deleteConfirm", { name: deleteTarget?.name ?? "" })}
          </p>
          <AppModalFooter title={t("delete")} subtitle={deleteTarget?.key ?? ""}>
            <Button type="button" variant="outline" className="h-9" onClick={() => setDeleteTarget(null)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-9"
              disabled={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {t("delete")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    );
  }
}

