"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader, TABLE_HEAD_CLASS } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { upsertVehicleType } from "./vehicles-actions";
import type { VehicleTypeRow } from "./types";
import { queryKeys } from "@/lib/query/query-keys";

/** Same slug rule the callable enforces (`SLUG_KEY_RE`). */
const KEY_RE = /^[a-z0-9_]{1,40}$/;

/** The sprite fallback and the fuel-limit default both hang off this key. */
const LOCKED_KEY = "bike";

function keyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function VehicleTypesPanel({
  types,
  usage,
}: {
  types: VehicleTypeRow[];
  /** Vehicles currently carrying each `vehicle_type_key`. */
  usage: Record<string, number>;
}) {
  const t = useTranslations("pages.settings.vehicleTypes");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleTypeRow | null>(null);
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(
    () => [...types].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)),
    [types],
  );

  function reset() {
    setEditing(null);
    setKey("");
    setKeyTouched(false);
    setLabelEn("");
    setLabelAr("");
    setSortOrder("100");
    setActive(true);
  }

  function startAdd() {
    reset();
    setOpen(true);
  }

  function startEdit(row: VehicleTypeRow) {
    setEditing(row);
    setKey(row.key);
    setKeyTouched(true);
    setLabelEn(row.label_en);
    setLabelAr(row.label_ar);
    setSortOrder(String(row.sort_order || 100));
    setActive(row.is_active);
    setOpen(true);
  }

  async function save() {
    const resolvedKey = editing ? editing.key : keyFromLabel(key || labelEn);
    if (!KEY_RE.test(resolvedKey)) {
      toast.error(t("errors.invalid_key"));
      return;
    }
    if (!labelEn.trim()) {
      toast.error(t("errors.missing_fields"));
      return;
    }
    if (editing && resolvedKey === LOCKED_KEY && !active) {
      toast.error(t("bikeLocked"));
      return;
    }
    setSaving(true);
    const result = await upsertVehicleType({
      key: resolvedKey,
      labelEn,
      labelAr,
      isActive: active,
      sortOrder: Number(sortOrder) || 100,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(`errors.${result.error}`));
      return;
    }
    toast.success(t("saved"));
    setOpen(false);
    reset();
    // The Vehicles form and the Employees column both read this cache; without
    // the invalidation a type added here takes up to a minute to appear there.
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
    router.refresh();
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
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
              <TableHead className={TABLE_HEAD_CLASS}>{t("key")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelEn")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelAr")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colUsage")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colActive")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.key}
                  className="cursor-pointer"
                  onClick={() => startEdit(row)}
                >
                  <TableCell className="font-mono text-xs">{row.key}</TableCell>
                  <TableCell className="text-sm">{row.label_en || "—"}</TableCell>
                  <TableCell className="text-sm" dir="rtl">
                    {row.label_ar || "—"}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {usage[row.key] ?? 0}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.is_active ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900">
                        {t("activeLabel")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">
                        {t("inactiveLabel")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AppListCard>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent showCloseButton closeOutside className="w-[min(520px,96vw)] overflow-visible">
          <div className="space-y-3 px-5 pt-4 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="vt-en">{t("labelEn")}</Label>
              <Input
                id="vt-en"
                className="h-9"
                value={labelEn}
                onChange={(event) => {
                  setLabelEn(event.target.value);
                  if (!editing && !keyTouched) setKey(keyFromLabel(event.target.value));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vt-ar">{t("labelAr")}</Label>
              <Input
                id="vt-ar"
                className="h-9"
                dir="rtl"
                value={labelAr}
                onChange={(event) => setLabelAr(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vt-key">{t("key")}</Label>
              <Input
                id="vt-key"
                className="h-9 font-mono"
                value={key}
                disabled={Boolean(editing)}
                onChange={(event) => {
                  setKeyTouched(true);
                  setKey(event.target.value.toLowerCase());
                }}
              />
              <p className="text-[10px] leading-4 text-muted-foreground">
                {editing ? t("keyLocked") : t("keyHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vt-sort">{t("colSort")}</Label>
              <Input
                id="vt-sort"
                className="h-9 w-28 tabular-nums"
                inputMode="numeric"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="vt-active">{t("colActive")}</Label>
                <p className="text-xs leading-4 text-muted-foreground">
                  {editing?.key === LOCKED_KEY ? t("bikeLocked") : t("activeHint")}
                </p>
              </div>
              <Switch
                id="vt-active"
                checked={active}
                disabled={editing?.key === LOCKED_KEY}
                onCheckedChange={setActive}
              />
            </div>
          </div>
          <AppModalFooter
            title={editing ? t("edit") : t("add")}
            subtitle={t("title")}
          >
            <Button type="button" variant="outline" className="h-9" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" className="h-9" disabled={saving} onClick={() => void save()}>
              {t("save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
