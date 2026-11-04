"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader, TABLE_HEAD_CLASS } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { queryKeys } from "@/lib/query/query-keys";
import { ServiceTypeImportDialog } from "./service-type-import-dialog";
import {
  SERVICE_CATEGORY_KEYS,
  SERVICE_TYPE_KEY_RE,
  categoryForServiceType,
  serviceTypeKey,
  type ServiceCategoryKey,
} from "./service-types";
import { upsertServiceType } from "./service-types-actions";
import { isScheduledProgramKey } from "./service-programs";
import { serviceErrorKey } from "./use-service";
import type { ServiceTypeRow } from "./types";

export function ServiceTypesPanel({
  types,
  usage,
}: {
  types: ServiceTypeRow[];
  usage: Record<string, number>;
}) {
  const t = useTranslations("pages.settings.serviceTypes");
  const tCat = useTranslations("pages.fleetService.categories");
  const tErrors = useTranslations("pages.fleetService");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceTypeRow | null>(null);
  const [key, setKey] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [category, setCategory] = useState<ServiceCategoryKey>("other");
  const [sortOrder, setSortOrder] = useState("100");
  const [active, setActive] = useState(true);
  const [tracks, setTracks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  // The five programs the client approved cannot be un-scheduled from this page;
  // the action pins them on as well, so this is only the UI's half of the rule.
  const curatedKey = isScheduledProgramKey(editing?.key ?? key);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...types]
      .sort((a, b) => a.sort_order - b.sort_order || a.label_en.localeCompare(b.label_en))
      .filter((row) =>
        term
          ? [row.key, row.label_en, row.label_ar, row.category]
              .join(" ")
              .toLowerCase()
              .includes(term)
          : true,
      );
  }, [types, query]);

  function reset() {
    setEditing(null);
    setKey("");
    setLabelEn("");
    setLabelAr("");
    setCategory("other");
    setSortOrder("100");
    setActive(true);
    setTracks(false);
  }

  function startAdd() {
    reset();
    setOpen(true);
  }
  function startEdit(row: ServiceTypeRow) {
    setEditing(row);
    setKey(row.key);
    setLabelEn(row.label_en);
    setLabelAr(row.label_ar);
    setCategory(row.category);
    setSortOrder(String(row.sort_order || 100));
    setActive(row.is_active);
    setTracks(row.tracks_maintenance);
    setOpen(true);
  }

  async function save() {
    const resolvedKey = editing ? editing.key : serviceTypeKey(labelEn || key);    if (!SERVICE_TYPE_KEY_RE.test(resolvedKey)) {
      toast.error(t("errors.invalid_key"));
      return;
    }
    if (!labelEn.trim()) {
      toast.error(t("errors.missing_fields"));
      return;
    }
    setSaving(true);
    const result = await upsertServiceType({
      key: resolvedKey,
      labelEn,
      labelAr,
      category,
      isActive: active,
      sortOrder: Number(sortOrder || 100),
      tracksMaintenance: tracks,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(tErrors(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("saved"));
    setOpen(false);
    reset();
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.types() });
    router.refresh();
  }

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4" />
              {t("import")}
            </Button>
            <Button type="button" className="h-9" onClick={startAdd}>
              <Plus className="h-4 w-4" />
              {t("add")}
            </Button>
          </div>
        }
      />

      <AppListCard
        title={t("tableTitle", { count: types.length })}
        headerActions={
          <div className="w-[16rem]">
            <Input
              className="h-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("key")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("labelEn")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("labelAr")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("category")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("records")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colScheduled")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colActive")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className="cursor-pointer" onClick={() => startEdit(row)}>
                  <TableCell className="font-mono text-xs">{row.key}</TableCell>
                  <TableCell>{row.label_en}</TableCell>
                  <TableCell dir="rtl">{row.label_ar || "—"}</TableCell>
                  <TableCell className="text-xs">{tCat(row.category)}</TableCell>
                  <TableCell className="tabular-nums">{usage[row.key] ?? 0}</TableCell>
                  <TableCell>
                    <Switch
                      checked={row.tracks_maintenance}
                      disabled
                      aria-label={t("colScheduled")}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={row.is_active} disabled aria-label={t("colActive")} />
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {query ? t("noMatches") : t("empty")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
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
              <Label htmlFor="st-en">{t("labelEn")}</Label>
              <Input
                id="st-en"
                className="h-9"
                value={labelEn}
                onChange={(event) => {
                  setLabelEn(event.target.value);
                  if (!editing) {
                    setKey(serviceTypeKey(event.target.value));
                    setCategory(categoryForServiceType(event.target.value));
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-ar">{t("labelAr")}</Label>
              <Input
                id="st-ar"
                className="h-9"
                dir="rtl"
                value={labelAr}
                onChange={(event) => setLabelAr(event.target.value)}
              />
              <p className="text-[10px] leading-4 text-muted-foreground">{t("arabicHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-key">{t("key")}</Label>
              <Input
                id="st-key"
                className="h-9 font-mono"
                value={key}
                disabled={Boolean(editing)}
                onChange={(event) => setKey(event.target.value.toLowerCase())}
              />
              <p className="text-[10px] leading-4 text-muted-foreground">
                {editing ? t("keyLocked") : t("keyHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("category")}</Label>
              <Select
                items={SERVICE_CATEGORY_KEYS.map((value) => ({ value, label: tCat(value) }))}
                value={category}
                onValueChange={(value) => setCategory(value as ServiceCategoryKey)}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORY_KEYS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {tCat(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-sort">{t("colSort")}</Label>
              <Input
                id="st-sort"
                className="h-9 w-28 tabular-nums"
                inputMode="numeric"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="st-active">{t("colActive")}</Label>
                <p className="text-xs leading-4 text-muted-foreground">{t("activeHint")}</p>
              </div>
              <Switch id="st-active" checked={active} onCheckedChange={setActive} />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="st-tracks">{t("tracksMaintenance")}</Label>
                <p className="text-xs leading-4 text-muted-foreground">
                  {curatedKey ? t("tracksLocked") : t("tracksHint")}
                </p>
              </div>
              <Switch
                id="st-tracks"
                checked={curatedKey ? true : tracks}
                disabled={curatedKey}
                onCheckedChange={setTracks}
              />
            </div>
          </div>
          <AppModalFooter title={editing ? t("edit") : t("add")} subtitle={t("title")}>
            <Button type="button" variant="outline" className="h-9" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" className="h-9" disabled={saving} onClick={() => void save()}>
              {t("save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>

      <ServiceTypeImportDialog open={importOpen} onOpenChange={setImportOpen} existing={types} />
    </AppPage>
  );
}
