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
import { ColumnsButton } from "@/components/app/columns-button";
import { useColumnLayout } from "@/hooks/use-column-layout";
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
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { driverSearchOptions } from "@/lib/search-options";
import { selectOptions } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { isEsignDueDateAllowed } from "./esign-due-date";
import { uploadEsignDocument } from "./esign-actions";
import { EsignKpiStrip } from "./esign-kpi-strip";
import {
  useCreateEsignRequest,
  useEsignBatches,
  useEsignCategories,
  useEsignDriverOptions,
  useEsignRequestsList,
  useEsignStatusCounts,
  useEsignTemplates,
} from "./use-esign";
import type { EsignRequestStatus } from "./types";

const STATUS_TABS = ["all", "pending", "signed", "declined", "expired"] as const;

type StatusTab = (typeof STATUS_TABS)[number];

/**
 * The sent list's columns, in catalogue order.
 *
 * The request code and the rider stay pinned: the code is the identity the row
 * is quoted by and the rider is who it was sent to, so a list where either can
 * be moved off the end or hidden is a list of anonymous documents.
 */
const SENT_COLUMNS = [
  { id: "code", pinned: true },
  { id: "driver", pinned: true },
  { id: "title", pinned: false },
  { id: "category", pinned: false },
  { id: "batch", pinned: false },
  { id: "status", pinned: false },
  { id: "sent", pinned: false },
  { id: "due", pinned: false },
] as const;

type SentColumnId = (typeof SENT_COLUMNS)[number]["id"];

const SENT_COLUMN_LABELS: Record<SentColumnId, string> = {
  code: "colCode",
  driver: "colDriver",
  title: "colTitle",
  category: "colCategory",
  batch: "colBatch",
  status: "colStatus",
  sent: "colSent",
  due: "colDue",
};

const SENT_COLUMN_CLASS: Record<SentColumnId, string> = {
  code: "",
  driver: "",
  title: "max-w-[320px]",
  category: "",
  batch: "",
  status: "",
  sent: "",
  due: "",
};

const SENT_CELL_CLASS: Record<SentColumnId, string> = {
  code: "font-mono text-xs",
  driver: "text-sm",
  title: "max-w-[320px] truncate text-sm font-medium",
  category: "text-sm",
  batch: "font-mono text-xs",
  status: "",
  sent: "text-sm tabular-nums",
  due: "text-sm tabular-nums",
};

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
  const tHub = useTranslations("pages.requests.esign.hub");
  const tRcm = useTranslations("pages.rcmV2");
  const router = useRouter();
  const pathname = usePathname();
  const isV2 = pathname.includes("/employeedesk");
  const hubHref = isV2 ? "/employeedesk" : "/requests/esign";
  const sentHref = isV2 ? "/employeedesk/esign/sent" : "/requests/esign/sent";
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [categoryKey, setCategoryKey] = useState<string>("");
  const [dueAt, setDueAt] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  const listFilters = useMemo(
    () => ({
      status: statusTab === "all" ? null : (statusTab as EsignRequestStatus),
      template_id: templateId,
      batch_id: batchId,
    }),
    [statusTab, templateId, batchId],
  );

  const { data, isLoading, isFetching, refetch } = useEsignRequestsList(listFilters);
  /**
   * Column order and visibility for this list, saved in the browser per table.
   * Declared here so the header row and the cells read the exact same order.
   */
  const sentColumnIds = useMemo(() => SENT_COLUMNS.map((column) => column.id), []);
  const sentLockedColumns = useMemo(
    () => SENT_COLUMNS.filter((column) => column.pinned).map((column) => column.id),
    [],
  );
  const sentColumns = useColumnLayout("esign.sent", sentColumnIds, {
    lockedIds: sentLockedColumns,
  });
  const sentShownColumns = sentColumns.order.filter((id) => sentColumns.isVisible(id)) as SentColumnId[];
  const { data: counts } = useEsignStatusCounts();
  const { data: driversData } = useEsignDriverOptions();
  const { data: categoriesData } = useEsignCategories();
  const { data: templatesData } = useEsignTemplates();
  const { data: batchesData } = useEsignBatches();
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

  /**
   * One cell, chosen by column id, so a hidden column and a moved column cannot
   * put the wrong value under the wrong heading.
   */
  function renderSentCell(row: (typeof rows)[number], id: SentColumnId) {
    switch (id) {
      case "code":
        return (
          <>
            {row.request_code}
            {/* ui-system §6: row click opens the detail page; the link is the affordance,
                so the list keeps Figma's column set instead of an actions column. */}
            <Link
              href={`/requests/esign/${row.id}`}
              className="mt-0.5 flex items-center gap-1 font-sans text-xs text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" />
              {t("viewDetails")}
            </Link>
          </>
        );
      case "driver":
        return (
          <>
            <div>{row.driver_name}</div>
            <div className="text-xs text-muted-foreground">{row.driver_code}</div>
          </>
        );
      case "title":
        return (
          <span className="block truncate" title={row.title ?? undefined}>
            {row.title}
          </span>
        );
      case "category":
        return row.category_label ?? "—";
      case "batch":
        return row.batch_code ?? "—";
      case "status":
        return (
          <StatusPill variant={statusVariant(row.status)}>
            {tCommon(`status.${row.status}`)}
          </StatusPill>
        );
      case "sent":
        return formatDay(row.created_at);
      case "due":
        return formatDay(row.due_at);
      default: {
        const exhaustive: never = id;
        return exhaustive;
      }
    }
  }

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setCreateOpen(true);
      router.replace(sentHref);
    }
  }, [searchParams, router, sentHref]);

  const submitCreate = async () => {
    if (!driverId || !title.trim() || !categoryKey || !documentFile) {
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

    const category = categories.find((row) => row.key === categoryKey);
    const result = await create.mutateAsync({
      driver_id: driverId,
      title: title.trim(),
      category_key: categoryKey,
      due_at: dueAt || null,
      document_storage_key: upload.key,
      screenshot_restricted: category?.screenshot_restricted ?? false,
    });
    if (!result.ok) {
      toast.error(
        result.error === "due_in_past"
          ? t("errors.due_in_past")
          : result.error === "category_required"
            ? t("errors.categoryRequired")
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
        breadcrumbs={
          isV2
            ? [
                { label: tRcm("outgoing"), href: "/employeedesk" },
                { label: t("title") },
              ]
            : [
                { label: tHub("requests"), href: "/employeedesk" },
                { label: tHub("title"), href: "/requests/esign" },
                { label: t("title") },
              ]
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href={hubHref} />}
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
            selected: statusTab === "all",
            onClick: () => setStatusTab("all"),
          },
          {
            label: t("kpiPending"),
            value: counts?.pending ?? "—",
            icon: Clock,
            accent: "warning",
            caption: t("kpiPendingCaption"),
            selected: statusTab === "pending",
            onClick: () => setStatusTab((tab) => (tab === "pending" ? "all" : "pending")),
          },
          {
            label: t("kpiSigned"),
            value: counts?.signed ?? "—",
            icon: ShieldCheck,
            accent: "success",
            caption: t("kpiSignedCaption"),
            selected: statusTab === "signed",
            onClick: () => setStatusTab((tab) => (tab === "signed" ? "all" : "signed")),
          },
          {
            label: t("kpiExpired"),
            value: counts?.expired ?? "—",
            icon: CircleSlash,
            caption: t("kpiExpiredCaption"),
            selected: statusTab === "expired",
            onClick: () => setStatusTab((tab) => (tab === "expired" ? "all" : "expired")),
          },
        ]}
      />

      <AppListCard className="p-0">
        <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
          <SearchSelect
            items={(templatesData?.rows ?? []).map((row) => ({
              value: row.id,
              label: row.name_en,
              keywords: [row.name_en, row.category_key, row.id],
            }))}
            value={templateId}
            onChange={setTemplateId}
            placeholder={t("filterTemplate")}
            searchPlaceholder={t("filterTemplateSearch")}
            recentsKey="esign-sent-template"
            className="w-[200px]"
          />
          <SearchSelect
            items={(batchesData?.rows ?? []).map((row) => ({
              value: row.id,
              label: row.batch_code,
              hint: row.title,
              keywords: [row.batch_code, row.title, row.id],
            }))}
            value={batchId}
            onChange={setBatchId}
            placeholder={t("filterBatch")}
            searchPlaceholder={t("filterBatchSearch")}
            recentsKey="esign-sent-batch"
            className="w-[180px]"
          />
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
                  <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
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
            toolbar={
              <div className="flex items-center justify-end gap-2 px-2 pb-2">
                <ColumnsButton
                  columns={sentColumns}
                  labelFor={(id) => t(SENT_COLUMN_LABELS[id as SentColumnId])}
                  pinned={t("pinnedColumns")}
                />
              </div>
            }
            columns={sentShownColumns.map((id) => ({
              id,
              label: t(SENT_COLUMN_LABELS[id]),
              className: SENT_COLUMN_CLASS[id],
            }))}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => router.push(`/requests/esign/${row.id}`)}
              >
                {sentShownColumns.map((id) => (
                  <TableCell key={id} className={SENT_CELL_CLASS[id]}>
                    {renderSentCell(row, id)}
                  </TableCell>
                ))}
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="overflow-visible pt-4" showCloseButton closeOutside>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>
                {t("fieldDriver")} <span className="text-destructive">*</span>
              </Label>
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
              <Label htmlFor="esign-title">
                {t("fieldTitle")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="esign-title"
                className="h-9"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("fieldTitlePlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label>
                {t("fieldCategory")} <span className="text-destructive">*</span>
              </Label>
              <Select
                items={selectOptions(categories.map((c) => ({ value: c.key, label: c.label_en })))}
                value={categoryKey || undefined}
                onValueChange={(v) => setCategoryKey(v ?? "")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("fieldCategoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
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
              <p className="text-xs text-muted-foreground">{t("fieldDocumentHint")}</p>
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
              disabled={
                create.isPending ||
                uploading ||
                !driverId ||
                !title.trim() ||
                !categoryKey ||
                !documentFile
              }
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
