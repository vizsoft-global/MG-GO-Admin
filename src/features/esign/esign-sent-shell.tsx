"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CircleSlash,
  Clock,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { driverSearchOptions } from "@/lib/search-options";
import { selectOptions } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { isEsignDueDateAllowed } from "./esign-due-date";
import { uploadEsignDocument } from "./esign-actions";
import { EsignKpiStrip } from "./esign-kpi-strip";
import {
  useCreateEsignRequest,
  useEsignCategories,
  useEsignDriverOptions,
  useEsignRequestsList,
  useEsignStatusCounts,
} from "./use-esign";
import type { EsignRequestStatus } from "./types";

const STATUS_TABS = ["all", "pending", "signed", "declined", "expired"] as const;

type StatusTab = (typeof STATUS_TABS)[number];

function statusVariant(
  status: EsignRequestStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "signed") return "success";
  if (status === "declined") return "danger";
  if (status === "expired" || status === "cancelled") return "neutral";
  if (status === "pending") return "warning";
  return "neutral";
}

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

export function EsignSentShell() {
  const t = useTranslations("pages.requests.esign.sent");
  const tCommon = useTranslations("pages.requests.esign");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [categoryKey, setCategoryKey] = useState<string>("");
  const [dueAt, setDueAt] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusTab, setStatusTab] = useState<StatusTab>("all");

  const listFilters = useMemo(
    () => ({ status: statusTab === "all" ? null : (statusTab as EsignRequestStatus) }),
    [statusTab],
  );

  const { data, isLoading, isFetching, refetch } = useEsignRequestsList(listFilters);
  const { data: counts } = useEsignStatusCounts();
  const { data: driversData } = useEsignDriverOptions();
  const { data: categoriesData } = useEsignCategories();
  const create = useCreateEsignRequest();

  const rows = data?.rows ?? [];
  const driverItems = useMemo(
    () =>
      driverSearchOptions(
        (driversData?.rows ?? []).map((d) => ({
          id: d.id,
          full_name: d.full_name,
          driver_code: d.driver_code,
          employee_id: d.employee_id,
        })),
      ),
    [driversData?.rows],
  );
  const categories = useMemo(
    () => categoriesData?.rows.filter((c) => c.is_active) ?? [],
    [categoriesData?.rows],
  );
  // Base UI Select renders the raw value in the trigger unless it is given `items`.
  const categoryItems = useMemo(
    () =>
      selectOptions([
        { value: "__none", label: t("fieldCategoryNone") },
        ...categories.map((c) => ({ value: c.key, label: c.label_en })),
      ]),
    [categories, t],
  );

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setCreateOpen(true);
      router.replace("/requests/esign/sent");
    }
  }, [searchParams, router]);

  const submitCreate = async () => {
    if (!driverId || !title.trim() || !documentFile) {
      toast.error(t("errors.missingFields"));
      return;
    }
    if (!isEsignDueDateAllowed(dueAt, kuwaitTodayYmd())) {
      toast.error(t("errors.due_in_past"));
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.set("file", documentFile);
    const upload = await uploadEsignDocument(formData);
    setUploading(false);
    if (!upload.ok || !upload.key) {
      const known = ["unsupported_source_type", "file_too_large"] as const;
      const code = known.find((c) => c === upload.error);
      toast.error(code ? t(`errors.${code}`) : (upload.error ?? t("errors.uploadFailed")));
      return;
    }

    const result = await create.mutateAsync({
      driver_id: driverId,
      title: title.trim(),
      category_key: categoryKey || null,
      due_at: dueAt || null,
      document_storage_key: upload.key,
    });
    if (!result.ok) {
      toast.error(
        result.error === "due_in_past"
          ? t("errors.due_in_past")
          : (result.error ?? t("errors.createFailed")),
      );
      return;
    }
    toast.success(t("created", { code: result.request_code ?? "" }));
    setCreateOpen(false);
    setDriverId(null);
    setTitle("");
    setCategoryKey("");
    setDueAt("");
    setDocumentFile(null);
    if (result.id) {
      router.push(`/requests/esign/${result.id}`);
    } else {
      await refetch();
    }
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tCommon("hub.requests"), href: "/requests" },
          { label: tCommon("hub.title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/requests/esign" />}
            >
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t("back")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="me-1.5 h-3.5 w-3.5" />
              {t("create")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")}
              />
              {t("refresh")}
            </Button>
          </div>
        }
      />

      <EsignKpiStrip
        items={[
          {
            label: t("kpiSent"),
            value: counts?.sentLast30d ?? "—",
            icon: Send,
            accent: "primary",
            caption: t("kpiSentCaption"),
          },
          {
            label: t("kpiPending"),
            value: counts?.pending ?? "—",
            icon: Clock,
            accent: "warning",
            caption: t("kpiPendingCaption"),
          },
          {
            label: t("kpiSigned"),
            value: counts?.signed ?? "—",
            icon: ShieldCheck,
            accent: "success",
            caption: t("kpiSignedCaption"),
          },
          {
            label: t("kpiExpired"),
            value: counts?.expired ?? "—",
            icon: CircleSlash,
            caption: t("kpiExpiredCaption"),
          },
        ]}
      />

      <AppListCard className="p-0">
        <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
          {STATUS_TABS.map((tab) => {
            const count =
              counts == null ? null : tab === "all" ? counts.all : counts[tab];
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusTab(tab)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                  statusTab === tab
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                {t(`filters.${tab}`)}
                {count != null ? (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: t("colCode") },
              { id: "driver", label: t("colDriver") },
              { id: "title", label: t("colTitle") },
              { id: "category", label: t("colCategory") },
              { id: "status", label: t("colStatus") },
              { id: "sent", label: t("colSent") },
              { id: "due", label: t("colDue") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => router.push(`/requests/esign/${row.id}`)}
              >
                <TableCell className="font-mono text-xs">
                  {row.request_code}
                  {/* ui-system §6: row click opens the detail page; the link is the affordance,
                      so the list keeps Figma's column set instead of an actions column. */}
                  <Link
                    href={`/requests/esign/${row.id}`}
                    className="mt-0.5 flex items-center gap-1 font-sans text-[10px] text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("viewDetails")}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">
                  <div>{row.driver_name}</div>
                  <div className="text-[11px] text-muted-foreground">{row.driver_code}</div>
                </TableCell>
                <TableCell
                  className="max-w-[320px] truncate text-sm font-medium"
                  title={row.title ?? undefined}
                >
                  {row.title}
                </TableCell>
                <TableCell className="text-sm">{row.category_label ?? "—"}</TableCell>
                <TableCell>
                  <StatusPill variant={statusVariant(row.status)}>
                    {tCommon(`status.${row.status}`)}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {formatDay(row.created_at)}
                </TableCell>
                <TableCell className="text-sm tabular-nums">{formatDay(row.due_at)}</TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="overflow-visible pt-4" showCloseButton closeOutside>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("fieldDriver")}</Label>
              <SearchSelect
                items={driverItems}
                value={driverId}
                onChange={setDriverId}
                placeholder={t("fieldDriverPlaceholder")}
                searchPlaceholder={t("fieldDriverSearch")}
                recentsKey="esign-create-driver"
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="esign-title">{t("fieldTitle")}</Label>
              <Input
                id="esign-title"
                className="h-9"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("fieldTitlePlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("fieldCategory")}</Label>
              <Select
                items={categoryItems}
                value={categoryKey || "__none"}
                onValueChange={(v) => setCategoryKey(v === "__none" ? "" : (v ?? ""))}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("fieldCategoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("fieldCategoryNone")}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="esign-due">{t("fieldDue")}</Label>
              <Input
                id="esign-due"
                type="date"
                className="h-9"
                min={kuwaitTodayYmd()}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="esign-document">
                {t("fieldDocument")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="esign-document"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="h-9 py-1.5"
                onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-[10px] text-muted-foreground">{t("fieldDocumentHint")}</p>
            </div>
          </div>
          <AppModalFooter title={t("createTitle")} subtitle={t("createSubtitle")}>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setCreateOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={create.isPending || uploading || !driverId || !title.trim() || !documentFile}
              onClick={() => void submitCreate()}
            >
              {create.isPending || uploading ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("send")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
