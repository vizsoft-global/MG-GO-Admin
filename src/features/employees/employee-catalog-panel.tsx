"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { catalogKeyFromLabel, CATALOG_KEY_RE, type EmployeeCatalogKind, type EmployeeCatalogRow } from "./employee-catalogs";
import { upsertEmployeeCatalog } from "./employee-catalogs-actions";
import { SponsorshipImportDialog } from "./sponsorship-import-dialog";
import { toast } from "sonner";

export function EmployeeCatalogPanel({
  kind,
  rows,
  title,
  subtitle,
}: {
  kind: EmployeeCatalogKind;
  rows: EmployeeCatalogRow[];
  title: string;
  subtitle: string;
}) {
  const t = useTranslations("pages.settings.employeeCatalogs");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [key, setKey] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EmployeeCatalogRow | null>(null);
  const [operational, setOperational] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [query, setQuery] = useState("");
  const isSections = kind === "employee_sections";
  const isSponsorships = kind === "sponsorships";

  /**
   * `sponsorships` ships fifty-one companies and `nationality_categories`
   * twenty-five, so a search beat scrolling the whole table.
   */
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.key, row.label_en, row.label_ar]
        .filter((value) => typeof value === "string")
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [query, rows]);

  const reset = () => {
    setKey("");
    setLabelEn("");
    setLabelAr("");
    setEditing(null);
    setOperational(true);
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(false);
  };

  const startAdd = () => {
    reset();
    setOpen(true);
  };

  const startEdit = (row: EmployeeCatalogRow) => {
    setEditing(row);
    setKey(row.key);
    setLabelEn(row.label_en);
    setLabelAr(row.label_ar);
    setOperational(row.is_operational !== false);
    setLogoFile(null);
    setLogoPreview(row.logo_display_url ?? null);
    setRemoveLogo(false);
    setOpen(true);
  };

  const save = async () => {
    const resolvedKey = editing?.key || catalogKeyFromLabel(labelEn) || key;
    if (!CATALOG_KEY_RE.test(resolvedKey) || !labelEn.trim()) {
      toast.error(t("invalid"));
      return;
    }
    setSaving(true);
    const result = await upsertEmployeeCatalog({
      kind,
      key: resolvedKey,
      labelEn,
      labelAr,
      isActive: editing?.is_active ?? true,
      sortOrder: editing?.sort_order,
      color: editing?.color,
      isOperational: isSections ? operational : undefined,
      logoFile: isSponsorships ? logoFile : undefined,
      removeLogo: isSponsorships ? removeLogo && !logoFile : undefined,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(`errors.${result.error}`));
      return;
    }
    toast.success(t("saved"));
    setOpen(false);
    reset();
    router.refresh();
  };

  return (
    <AppPage>
      <AppPageHeader
        title={title}
        description={subtitle}
        actions={
          <div className="flex items-center gap-2">
            <Input
              className="h-9 w-56"
              value={query}
              placeholder={t("search")}
              onChange={(event) => setQuery(event.target.value)}
            />
            {isSponsorships ? (
              <Button type="button" variant="outline" className="h-9" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                {t("import.action")}
              </Button>
            ) : null}
            <Button type="button" className="h-9" onClick={startAdd}>
              <Plus className="h-4 w-4" />
              {t("add")}
            </Button>
          </div>
        }
      />
      <AppListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colKey")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelEn")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelAr")}</TableHead>
              {isSponsorships ? (
                <TableHead className={TABLE_HEAD_CLASS}>{t("logo")}</TableHead>
              ) : null}
              <TableHead className={TABLE_HEAD_CLASS}>{t("colSystem")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow
                key={row.key}
                className="cursor-pointer"
                onClick={() => startEdit(row)}
              >
                <TableCell className="font-mono text-xs">{row.key}</TableCell>
                <TableCell className="text-sm">{row.label_en}</TableCell>
                <TableCell className="text-sm">{row.label_ar || "—"}</TableCell>
                {isSponsorships ? (
                  <TableCell>
                    {row.logo_display_url ? (
                      <img
                        src={row.logo_display_url}
                        alt=""
                        className="h-8 w-8 rounded-md border border-border object-contain"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {row.is_system ? t("system") : t("custom")}
                    {isSections && row.is_operational === false ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        {t("nonOperational")}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            ))}
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
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(520px,96vw)] overflow-visible"
        >
          <div className="space-y-3 px-5 pt-4 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="catalog-en">{t("colLabelEn")}</Label>
              <Input
                id="catalog-en"
                className="h-9"
                value={labelEn}
                onChange={(event) => {
                  setLabelEn(event.target.value);
                  if (!editing) setKey(catalogKeyFromLabel(event.target.value));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="catalog-ar">{t("colLabelAr")}</Label>
              <Input
                id="catalog-ar"
                className="h-9"
                value={labelAr}
                onChange={(event) => setLabelAr(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="catalog-key">{t("colKey")}</Label>
              <Input
                id="catalog-key"
                className="h-9 font-mono"
                value={key}
                disabled={Boolean(editing)}
                onChange={(event) => setKey(event.target.value.toLowerCase())}
              />
            </div>
            {isSponsorships ? (
              <div className="space-y-1.5">
                <Label htmlFor="catalog-logo">{t("logo")}</Label>
                <div className="flex items-center gap-2">
                  {logoPreview ? (
                    <img
                      src={logoPreview}
                      alt=""
                      className="h-9 w-9 rounded-md border border-border object-contain"
                    />
                  ) : null}
                  <Input
                    id="catalog-logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="h-9"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setLogoFile(file);
                      setRemoveLogo(false);
                      setLogoPreview(file ? URL.createObjectURL(file) : logoPreview);
                    }}
                  />
                </div>
                <p className="text-[10px] leading-4 text-muted-foreground">{t("logoHint")}</p>
                {logoPreview ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 px-2 text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setLogoFile(null);
                      setLogoPreview(null);
                      setRemoveLogo(true);
                    }}
                  >
                    {t("removeLogo")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {isSections ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="catalog-operational">{t("operational")}</Label>
                  <p className="text-xs leading-4 text-muted-foreground">
                    {t("operationalHint")}
                  </p>
                </div>
                <Switch
                  id="catalog-operational"
                  checked={operational}
                  onCheckedChange={setOperational}
                />
              </div>
            ) : null}
          </div>
          <AppModalFooter title={editing ? t("edit") : t("add")} subtitle={title}>
            <Button type="button" variant="outline" className="h-9" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" className="h-9" disabled={saving} onClick={() => void save()}>
              {t("save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
      {isSponsorships ? (
        <SponsorshipImportDialog open={importOpen} onOpenChange={setImportOpen} rows={rows} />
      ) : null}
    </AppPage>
  );
}
