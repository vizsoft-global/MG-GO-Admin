"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Plus, RefreshCw } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  useCreateEsignRequest,
  useEsignCategories,
  useEsignDriverOptions,
  useEsignRequestsList,
} from "./use-esign";
import type { EsignRequestStatus } from "./types";

function statusVariant(
  status: EsignRequestStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "signed") return "success";
  if (status === "expired" || status === "cancelled") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
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

  const { data, isLoading, isFetching, refetch } = useEsignRequestsList({});
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
  const categories = categoriesData?.rows.filter((c) => c.is_active) ?? [];

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setCreateOpen(true);
      router.replace("/requests/esign/sent");
    }
  }, [searchParams, router]);

  const submitCreate = async () => {
    if (!driverId || !title.trim()) {
      toast.error(t("errors.missingFields"));
      return;
    }
    const result = await create.mutateAsync({
      driver_id: driverId,
      title: title.trim(),
      category_key: categoryKey || null,
      due_at: dueAt || null,
    });
    if (!result.ok) {
      toast.error(result.error ?? t("errors.createFailed"));
      return;
    }
    toast.success(t("created", { code: result.request_code ?? "" }));
    setCreateOpen(false);
    setDriverId(null);
    setTitle("");
    setCategoryKey("");
    setDueAt("");
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

      <AppListCard className="mt-2">
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
              { id: "title", label: t("colTitle") },
              { id: "driver", label: t("colDriver") },
              { id: "category", label: t("colCategory") },
              { id: "due", label: t("colDue") },
              { id: "status", label: t("colStatus") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => router.push(`/requests/esign/${row.id}`)}
              >
                <TableCell className="font-mono text-xs">{row.request_code}</TableCell>
                <TableCell className="max-w-[180px] truncate text-sm font-medium">
                  {row.title}
                </TableCell>
                <TableCell className="text-sm">
                  <div>{row.driver_name}</div>
                  <div className="text-[11px] text-muted-foreground">{row.driver_code}</div>
                </TableCell>
                <TableCell className="text-sm">{row.category_label ?? "—"}</TableCell>
                <TableCell className="text-sm tabular-nums">{row.due_at ?? "—"}</TableCell>
                <TableCell>
                <StatusPill variant={statusVariant(row.status)}>
                  {tCommon(`status.${row.status}`)}
                </StatusPill>
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-primary hover:bg-primary/10"
                    render={<Link href={`/requests/esign/${row.id}`} />}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="me-1 h-3.5 w-3.5" />
                    {t("viewDetails")}
                  </Button>
                </TableCell>
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
              />
            </div>
            <div className="space-y-1">
              <Label>{t("fieldCategory")}</Label>
              <Select value={categoryKey || "__none"} onValueChange={(v) => setCategoryKey(v === "__none" ? "" : (v ?? ""))}>
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
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
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
              disabled={create.isPending || !driverId || !title.trim()}
              onClick={() => void submitCreate()}
            >
              {create.isPending ? (
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
