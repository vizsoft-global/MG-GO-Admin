"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
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
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { getSignedStorageUrl } from "@/lib/storage/storage-actions";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { AssetFormSheet } from "@/features/assets/asset-form-sheet";
import type { VehicleListRow } from "./types";
import {
  assignVehicleAsset,
  createVehicleAccident,
  createVehicleDocument,
  createVehicleHandover,
  createVehicleService,
  listVehicleAccidents,
  listVehicleAssignedAssets,
  listVehicleAssetCatalog,
  listVehicleDocuments,
  listVehicleHandovers,
  listVehicleServices,
  listVehicleTabDrivers,
} from "./vehicle-tabs-actions";

type TabId = "handover" | "accident" | "documents" | "service" | "assets";

const DOC_TYPE_VALUES = ["registration", "insurance", "other"] as const;

/** Local "now" in the `datetime-local` wire format, used as an input `max`. */
function localDateTimeInputMax(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function VehicleDetailTabs({
  tab,
  vehicle,
  canManage,
}: {
  tab: TabId;
  vehicle: VehicleListRow;
  canManage: boolean;
}) {
  if (tab === "handover") return <HandoverTab vehicleId={vehicle.id} canManage={canManage} />;
  if (tab === "accident") return <AccidentTab vehicleId={vehicle.id} canManage={canManage} />;
  if (tab === "documents") return <DocumentsTab vehicleId={vehicle.id} canManage={canManage} />;
  if (tab === "service") return <ServiceTab vehicleId={vehicle.id} canManage={canManage} />;
  return <AssetsTab vehicle={vehicle} />;
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div className="flex justify-end">
      <Button type="button" className="h-9" onClick={onClick}>
        <Plus className="me-2 size-3.5" />
        {label}
      </Button>
    </div>
  );
}

function FileLink({ storageKey }: { storageKey: string | null }) {
  const t = useTranslations("pages.vehicleDetail");
  if (!storageKey) return <span>—</span>;
  return (
    <button
      type="button"
      className="text-primary hover:bg-primary/10"
      onClick={async () => {
        const result = await getSignedStorageUrl(storageKey);
        if (result.url) window.open(result.url, "_blank", "noopener");
        else toast.error(t("errors.save_failed"));
      }}
    >
      {t("openFile")}
    </button>
  );
}

function HandoverTab({ vehicleId, canManage }: { vehicleId: string; canManage: boolean }) {
  const t = useTranslations("pages.vehicleDetail");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: queryKeys.vehicles.tabs(vehicleId, "handover"),
    queryFn: () => listVehicleHandovers(vehicleId),
  });
  const drivers = useQuery({ queryKey: [...queryKeys.vehicles.all(), "tab-drivers"], queryFn: listVehicleTabDrivers });
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      {canManage ? <AddButton onClick={() => setOpen(true)} label={t("addHandover")} /> : null}
      {rows.length === 0 ? (
        <AppEmptyState title={t("emptyHandover")} />
      ) : (
        <TabTable
          heads={[t("colWhen"), t("colFrom"), t("colTo"), t("colNotes"), t("colFile")]}
          rows={rows.map((row) => [
            row.handed_at.slice(0, 10),
            row.from_name ?? "—",
            row.to_name ?? "—",
            row.notes ?? "—",
            <FileLink key={row.id} storageKey={row.storage_key} />,
          ])}
        />
      )}
      <LedgerDialog
        open={open}
        title={t("addHandover")}
        subtitle={t("handoverSubtitle")}
        successMessage={t("handoverSaved")}
        onClose={() => setOpen(false)}
        onSubmit={async (form) => {
          const from = String(form.get("fromDriverId") ?? "").trim();
          const to = String(form.get("toDriverId") ?? "").trim();
          if (!from || !to) return "invalid_drivers";
          if (from === to) return "same_driver";
          form.set("vehicleId", vehicleId);
          const result = await createVehicleHandover(form);
          if (result.error) return result.error;
          void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.tabs(vehicleId, "handover") });
          setOpen(false);
          return null;
        }}
      >
        <label className="space-y-1 text-xs">
          {t("colWhen")}
          <Input name="handedAt" type="datetime-local" required className="h-9" />
        </label>
        <DriverField name="fromDriverId" label={t("colFrom")} items={drivers.data ?? []} required />
        <DriverField name="toDriverId" label={t("colTo")} items={drivers.data ?? []} required />
        <label className="space-y-1 text-xs">
          {t("colNotes")}
          <Input name="notes" className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colFile")}
          <Input name="file" type="file" className="h-9" />
        </label>
      </LedgerDialog>
    </div>
  );
}

function AccidentTab({ vehicleId, canManage }: { vehicleId: string; canManage: boolean }) {
  const t = useTranslations("pages.vehicleDetail");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: queryKeys.vehicles.tabs(vehicleId, "accident"),
    queryFn: () => listVehicleAccidents(vehicleId),
  });
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      {canManage ? <AddButton onClick={() => setOpen(true)} label={t("addAccident")} /> : null}
      {rows.length === 0 ? (
        <AppEmptyState title={t("emptyAccident")} />
      ) : (
        <TabTable
          heads={[t("colWhen"), t("colLocation"), t("colSeverity"), t("colNotes"), t("colFile")]}
          rows={rows.map((row) => [
            row.occurred_at.slice(0, 10),
            row.location_text ?? "—",
            t(`severity.${row.severity}` as "severity.medium"),
            row.notes ?? "—",
            <FileLink key={row.id} storageKey={row.storage_key} />,
          ])}
        />
      )}
      <LedgerDialog
        open={open}
        title={t("addAccident")}
        subtitle={t("accidentSubtitle")}
        successMessage={t("accidentSaved")}
        onClose={() => setOpen(false)}
        onSubmit={async (form) => {
          form.set("vehicleId", vehicleId);
          const result = await createVehicleAccident(form);
          if (result.error) return result.error;
          void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.tabs(vehicleId, "accident") });
          setOpen(false);
          return null;
        }}
      >
        <label className="space-y-1 text-xs">
          {t("colWhen")}
          <Input
            name="occurredAt"
            type="datetime-local"
            required
            max={open ? localDateTimeInputMax() : undefined}
            className="h-9"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span>
            {t("colLocation")}
            <span className="text-destructive"> *</span>
          </span>
          <Input name="locationText" required className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colSeverity")}
          <select name="severity" defaultValue="medium" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="low">{t("severity.low")}</option>
            <option value="medium">{t("severity.medium")}</option>
            <option value="high">{t("severity.high")}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          {t("colNotes")}
          <Input name="notes" className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colFile")}
          <Input name="file" type="file" className="h-9" />
        </label>
      </LedgerDialog>
    </div>
  );
}

function DocumentsTab({ vehicleId, canManage }: { vehicleId: string; canManage: boolean }) {
  const t = useTranslations("pages.vehicleDetail");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: queryKeys.vehicles.tabs(vehicleId, "documents"),
    queryFn: () => listVehicleDocuments(vehicleId),
  });
  const rows = list.data ?? [];
  const docTypeItems = [
    { value: "registration", label: t("docType.registration") },
    { value: "insurance", label: t("docType.insurance") },
    { value: "other", label: t("docType.other") },
  ];
  const docTypeLabel = (value: string): string => {
    if (value === "registration") return t("docType.registration");
    if (value === "insurance") return t("docType.insurance");
    if (value === "other") return t("docType.other");
    return value;
  };
  return (
    <div className="space-y-3">
      {canManage ? <AddButton onClick={() => setOpen(true)} label={t("addDocument")} /> : null}
      {rows.length === 0 ? (
        <AppEmptyState title={t("emptyDocuments")} />
      ) : (
        <TabTable
          heads={[t("colDocType"), t("colExpires"), t("colFile")]}
          rows={rows.map((row) => [
            docTypeLabel(row.doc_type),
            row.expires_at ?? "—",
            <FileLink key={row.id} storageKey={row.storage_key} />,
          ])}
        />
      )}
      <LedgerDialog
        open={open}
        title={t("addDocument")}
        subtitle={t("documentsSubtitle")}
        successMessage={t("documentSaved")}
        onClose={() => setOpen(false)}
        onSubmit={async (form) => {
          form.set("vehicleId", vehicleId);
          const result = await createVehicleDocument(form);
          if (result.error) return result.error;
          void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.tabs(vehicleId, "documents") });
          setOpen(false);
          return null;
        }}
      >
        <label className="space-y-1 text-xs">
          {t("colDocType")}
          <Select name="docType" defaultValue="registration" items={docTypeItems}>
            <SelectTrigger className="h-9 w-full" aria-label={t("colDocType")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_TYPE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {docTypeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs">
          {t("colExpires")}
          <Input name="expiresAt" type="date" min={open ? kuwaitTodayYmd() : undefined} className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colFile")}
          <Input name="file" type="file" required className="h-9" />
        </label>
      </LedgerDialog>
    </div>
  );
}

function ServiceTab({ vehicleId, canManage }: { vehicleId: string; canManage: boolean }) {
  const t = useTranslations("pages.vehicleDetail");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: queryKeys.vehicles.tabs(vehicleId, "service"),
    queryFn: () => listVehicleServices(vehicleId),
  });
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      {canManage ? <AddButton onClick={() => setOpen(true)} label={t("addService")} /> : null}
      {rows.length === 0 ? (
        <AppEmptyState title={t("emptyService")} />
      ) : (
        <TabTable
          heads={[t("colWhen"), t("colKind"), t("colOdometer"), t("colVendor"), t("colCost"), t("colNotes")]}
          rows={rows.map((row) => [
            row.serviced_at.slice(0, 10),
            row.kind,
            row.odometer ?? "—",
            row.vendor ?? "—",
            row.cost_kwd ?? "—",
            row.notes ?? "—",
          ])}
        />
      )}
      <LedgerDialog
        open={open}
        title={t("addService")}
        subtitle={t("serviceSubtitle")}
        successMessage={t("serviceSaved")}
        onClose={() => setOpen(false)}
        onSubmit={async (form) => {
          form.set("vehicleId", vehicleId);
          const result = await createVehicleService(form);
          if (result.error) return result.error;
          void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.tabs(vehicleId, "service") });
          setOpen(false);
          return null;
        }}
      >
        <label className="space-y-1 text-xs">
          {t("colWhen")}
          <Input
            name="servicedAt"
            type="date"
            required
            max={open ? kuwaitTodayYmd() : undefined}
            className="h-9"
          />
        </label>
        <label className="space-y-1 text-xs">
          {t("colKind")}
          <Input name="kind" defaultValue="service" className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colOdometer")}
          <Input name="odometer" type="number" min={0} className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colVendor")}
          <Input name="vendor" className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colCost")}
          <Input name="costKwd" type="number" min={0} step="0.001" className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colNotes")}
          <Input name="notes" className="h-9" />
        </label>
      </LedgerDialog>
    </div>
  );
}

function AssetsTab({ vehicle }: { vehicle: VehicleListRow }) {
  const t = useTranslations("pages.vehicleDetail");
  const { can } = useAuth();
  const canAssign = can("assets.manage");
  const canCreate = can("assets.create");
  const queryClient = useQueryClient();
  const driverId = vehicle.assigned_driver_id;
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const list = useQuery({
    queryKey: queryKeys.vehicles.tabs(driverId ?? "none", "assets"),
    queryFn: () => listVehicleAssignedAssets(driverId),
  });
  const catalog = useQuery({
    queryKey: [...queryKeys.vehicles.all(), "asset-catalog"],
    queryFn: listVehicleAssetCatalog,
    enabled: canAssign,
  });
  const rows = list.data ?? [];

  const assign = () => {
    if (!driverId || !catalogId) return;
    startTransition(async () => {
      const result = await assignVehicleAsset({
        driverId,
        catalogItemId: catalogId,
        quantity: Number(qty) || 1,
      });
      if (result.error) {
        toast.error(t(`errors.${result.error}` as "errors.save_failed"));
        return;
      }
      toast.success(t("assetAssigned"));
      setCatalogId(null);
      setQty("1");
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.tabs(driverId, "assets") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all() });
    });
  };

  if (!driverId) {
    return (
      <div className="space-y-3">
        {canCreate ? (
          <div className="flex justify-end">
            <Button type="button" variant="outline" className="h-9" onClick={() => setAddOpen(true)}>
              <Plus className="me-2 size-3.5" />
              {t("addAsset")}
            </Button>
          </div>
        ) : null}
        <AppEmptyState title={t("emptyAssetsNoDriver")} />
        <AssetFormSheet
          asset={null}
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={() => {
            setAddOpen(false);
            void queryClient.invalidateQueries({ queryKey: [...queryKeys.vehicles.all(), "asset-catalog"] });
            void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all() });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-end gap-2">
        {canAssign ? (
          <>
            <div className="w-[min(280px,100%)]">
              <SearchSelect
                items={(catalog.data ?? []).map((item) => ({
                  value: item.id,
                  label: item.label,
                  keywords: item.keywords,
                }))}
                value={catalogId}
                onChange={setCatalogId}
                placeholder={t("assignAssetPlaceholder")}
                searchPlaceholder={t("assignAssetPlaceholder")}
                recentsKey="vehicle-assign-asset"
                className="h-9"
              />
            </div>
            <Input
              className="h-9 w-20"
              inputMode="numeric"
              value={qty}
              onChange={(event) => setQty(event.target.value.replace(/\D/g, ""))}
              aria-label={t("colQty")}
            />
            <Button type="button" className="h-9" disabled={pending || !catalogId} onClick={assign}>
              {t("assignAsset")}
            </Button>
          </>
        ) : null}
        {canCreate ? (
          <Button type="button" variant="outline" className="h-9" onClick={() => setAddOpen(true)}>
            <Plus className="me-2 size-3.5" />
            {t("addAsset")}
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <AppEmptyState title={t("emptyAssets")} />
      ) : (
        <TabTable
          heads={[t("colAsset"), t("colQty"), t("colWhen")]}
          rows={rows.map((row) => [
            row.code ? `${row.name} · ${row.code}` : row.name,
            String(row.quantity),
            row.assigned_at?.slice(0, 10) ?? "—",
          ])}
        />
      )}
      <AssetFormSheet
        asset={null}
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={() => {
          setAddOpen(false);
          void queryClient.invalidateQueries({ queryKey: [...queryKeys.vehicles.all(), "asset-catalog"] });
          void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all() });
        }}
      />
    </div>
  );
}

function TabTable({ heads, rows }: { heads: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            {heads.map((head) => (
              <TableHead key={head} className={TABLE_HEAD_CLASS}>
                {head}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((cells, index) => (
            <TableRow key={index}>
              {cells.map((cell, cellIndex) => (
                <TableCell key={cellIndex}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DriverField({
  name,
  label,
  items,
  required,
}: {
  name: string;
  label: string;
  items: Array<{ id: string; label: string }>;
  required?: boolean;
}) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <label className="space-y-1 text-xs">
      <span>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      <input type="hidden" name={name} value={value ?? ""} />
      <SearchSelect
        items={items.map((item) => ({ value: item.id, label: item.label }))}
        value={value}
        onChange={setValue}
        recentsKey={`vehicle-tab-${name}`}
        className="h-9"
        searchPlaceholder={label}
      />
    </label>
  );
}

function LedgerDialog({
  open,
  title,
  subtitle,
  successMessage,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  successMessage?: string;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<string | null>;
  children: ReactNode;
}) {
  const t = useTranslations("pages.vehicles");
  const tDetail = useTranslations("pages.vehicleDetail");
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent
        showCloseButton
        closeOutside
        className="flex max-h-[min(92vh,880px)] w-[min(1200px,96vw)] max-w-none flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-[min(1200px,96vw)]"
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            startTransition(async () => {
              const error = await onSubmit(form);
              if (error) toast.error(tDetail(`errors.${error}` as "errors.save_failed"));
              else toast.success(successMessage ?? t("saved"));
            });
          }}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">{children}</div>
          <div className="px-5 pb-4">
            <AppModalFooter title={title} subtitle={subtitle}>
              <Button type="button" variant="outline" className="h-9" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button type="submit" className="h-9" disabled={pending}>
                {t("save")}
              </Button>
            </AppModalFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
