"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { groupHeaderProps, groupRows, GroupTableHeaderRow, useGroupedListView } from "@/components/app/app-list-controls";
import { AppEmptyState } from "@/components/app/app-empty-state";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
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
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { getSignedStorageUrl } from "@/lib/storage/storage-actions";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { AssetFormSheet } from "@/features/assets/asset-form-sheet";
import { isLegacyVehicleDocType, VEHICLE_DOC_TYPE_VALUES } from "./vehicle-doc-types";
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

const DOC_TYPE_VALUES = VEHICLE_DOC_TYPE_VALUES;

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
  if (tab === "documents") return <DocumentsTab vehicle={vehicle} canManage={canManage} />;
  if (tab === "service") return <ServiceTab vehicleId={vehicle.id} canManage={canManage} />;
  return <AssetsTab vehicle={vehicle} />;
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
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "when", label: t("colWhen") },
      { id: "from", label: t("colFrom") },
      { id: "to", label: t("colTo") },
      { id: "notes", label: t("colNotes") },
      { id: "file", label: t("colFile") },
    ],
    [t],
  );
  return (
    <div className="space-y-3">
      <TabTable
        tableId={`vehicle-handover-${vehicleId}`}
        entity={t("addHandover")}
        columns={columns}
        onAdd={canManage ? () => setOpen(true) : undefined}
        addLabel={t("addHandover")}
        empty={<AppEmptyState title={t("emptyHandover")} />}
        rows={rows.map((row) => ({
          id: row.id,
          search: [row.handed_at, row.from_name, row.to_name, row.notes].filter(Boolean).join(" "),
          cells: {
            when: row.handed_at.slice(0, 10),
            from: row.from_name ? <TableNameCell name={row.from_name} /> : <EmptyCell />,
            to: row.to_name ? <TableNameCell name={row.to_name} /> : <EmptyCell />,
            notes: row.notes || <EmptyCell />,
            file: <FileLink storageKey={row.storage_key} />,
          },
        }))}
      />
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
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "when", label: t("colWhen") },
      { id: "location", label: t("colLocation") },
      { id: "severity", label: t("colSeverity"), categorical: true },
      { id: "notes", label: t("colNotes") },
      { id: "file", label: t("colFile") },
    ],
    [t],
  );
  return (
    <div className="space-y-3">
      <TabTable
        tableId={`vehicle-accident-${vehicleId}`}
        entity={t("addAccident")}
        columns={columns}
        onAdd={canManage ? () => setOpen(true) : undefined}
        addLabel={t("addAccident")}
        empty={<AppEmptyState title={t("emptyAccident")} />}
        rows={rows.map((row) => ({
          id: row.id,
          search: [row.occurred_at, row.location_text, row.severity, row.notes].filter(Boolean).join(" "),
          group: { severity: t(`severity.${row.severity}` as "severity.medium") },
          cells: {
            when: row.occurred_at.slice(0, 10),
            location: row.location_text || <EmptyCell />,
            severity: t(`severity.${row.severity}` as "severity.medium"),
            notes: row.notes || <EmptyCell />,
            file: <FileLink storageKey={row.storage_key} />,
          },
        }))}
      />
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

function DocumentsTab({ vehicle, canManage }: { vehicle: VehicleListRow; canManage: boolean }) {
  const t = useTranslations("pages.vehicleDetail");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const vehicleId = vehicle.id;
  const today = kuwaitTodayYmd();
  const onRecord = [
    {
      key: "registrationIssued",
      label: t("docRegistrationIssued"),
      ymd: toKuwaitYmd(vehicle.registration_issued_at),
      expiring: false,
    },
    {
      key: "registrationExpires",
      label: t("docRegistrationExpires"),
      ymd: toKuwaitYmd(vehicle.registration_expires_at),
      expiring: true,
    },
    {
      key: "insuranceIssued",
      label: t("docInsuranceIssued"),
      ymd: toKuwaitYmd(vehicle.insurance_issued_at),
      expiring: false,
    },
    {
      key: "insuranceExpires",
      label: t("docInsuranceExpires"),
      ymd: toKuwaitYmd(vehicle.insurance_expires_at),
      expiring: true,
    },
  ].map((row) => ({ ...row, expired: row.expiring && Boolean(row.ymd) && row.ymd < today }));
  const list = useQuery({
    queryKey: queryKeys.vehicles.tabs(vehicleId, "documents"),
    queryFn: () => listVehicleDocuments(vehicleId),
  });
  const rows = list.data ?? [];
  const docTypeItems = [
    { value: "registration", label: t("docType.registration") },
    { value: "health_card", label: t("docType.healthCard") },
    { value: "baladiya_card", label: t("docType.baladiyaCard") },
  ];
  const docTypeLabel = (value: string): string => {
    if (value === "registration") return t("docType.registration");
    if (value === "health_card") return t("docType.healthCard");
    if (value === "baladiya_card") return t("docType.baladiyaCard");
    // Retired types stay readable, clearly marked as history.
    if (value === "insurance") return t("docType.insuranceLegacy");
    if (value === "other") return t("docType.otherLegacy");
    return value;
  };
  const hasLegacyRows = rows.some((row) => isLegacyVehicleDocType(row.doc_type));
  const docColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "type", label: t("colDocType"), locked: true, categorical: true },
      { id: "expires", label: t("colExpires") },
      { id: "file", label: t("colFile") },
    ],
    [t],
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {onRecord.map((row) => (
          <div key={row.key} className="rounded-xl border border-border bg-card px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">{row.label}</p>
            <p
              className={
                row.expired
                  ? "mt-0.5 text-xs font-semibold text-destructive"
                  : "mt-0.5 text-xs font-semibold text-foreground"
              }
            >
              {row.ymd || "—"}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("docsOnRecordHint")}</p>
      <TabTable
        tableId={`vehicle-documents-${vehicleId}`}
        entity={t("addDocument")}
        columns={docColumns}
        onAdd={canManage ? () => setOpen(true) : undefined}
        addLabel={t("addDocument")}
        empty={<AppEmptyState title={t("emptyDocuments")} />}
        rows={rows.map((row) => ({
          id: row.id,
          search: [docTypeLabel(row.doc_type), row.expires_at].filter(Boolean).join(" "),
          group: { type: docTypeLabel(row.doc_type) },
          cells: {
            type: (
              <span className="inline-flex items-center gap-1.5">
                {docTypeLabel(row.doc_type)}
                {isLegacyVehicleDocType(row.doc_type) ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {t("docType.legacy")}
                  </span>
                ) : null}
              </span>
            ),
            expires: row.expires_at || <EmptyCell />,
            file: <FileLink storageKey={row.storage_key} />,
          },
        }))}
      />
      {hasLegacyRows ? (
        <p className="text-xs text-muted-foreground">{t("docType.legacyDocHint")}</p>
      ) : null}
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
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "when", label: t("colWhen") },
      { id: "kind", label: t("colKind"), categorical: true },
      { id: "odometer", label: t("colOdometer") },
      { id: "vendor", label: t("colVendor") },
      { id: "cost", label: t("colCost") },
      { id: "notes", label: t("colNotes") },
    ],
    [t],
  );
  return (
    <div className="space-y-3">
      <TabTable
        tableId={`vehicle-service-${vehicleId}`}
        entity={t("addService")}
        columns={columns}
        onAdd={canManage ? () => setOpen(true) : undefined}
        addLabel={t("addService")}
        empty={<AppEmptyState title={t("emptyService")} />}
        rows={rows.map((row) => ({
          id: row.id,
          search: [row.serviced_at, row.kind, row.odometer, row.vendor, row.cost_kwd, row.notes]
            .filter((value) => value != null && value !== "")
            .join(" "),
          group: { kind: row.kind || "" },
          cells: {
            when: row.serviced_at.slice(0, 10),
            kind: row.kind || <EmptyCell />,
            odometer: row.odometer == null || row.odometer === "" ? <EmptyCell /> : String(row.odometer),
            vendor: row.vendor || <EmptyCell />,
            cost: row.cost_kwd == null || row.cost_kwd === "" ? <EmptyCell /> : String(row.cost_kwd),
            notes: row.notes || <EmptyCell />,
          },
        }))}
      />
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
  const assetColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "asset", label: t("colAsset"), locked: true },
      { id: "qty", label: t("colQty") },
      { id: "when", label: t("colWhen") },
    ],
    [t],
  );

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
      </div>
      <TabTable
        tableId={`vehicle-assets-${vehicle.id}`}
        entity={t("addAsset")}
        columns={assetColumns}
        onAdd={canCreate ? () => setAddOpen(true) : undefined}
        addLabel={t("addAsset")}
        empty={<AppEmptyState title={t("emptyAssets")} />}
        rows={rows.map((row) => ({
          id: row.id,
          search: [row.name, row.code, row.quantity, row.assigned_at].filter(Boolean).join(" "),
          cells: {
            asset: row.code ? `${row.name} · ${row.code}` : row.name,
            qty: String(row.quantity),
            when: row.assigned_at?.slice(0, 10) || <EmptyCell />,
          },
        }))}
      />
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

function TabTable({
  tableId,
  entity,
  columns,
  rows,
  onAdd,
  addLabel,
  empty,
}: {
  tableId: string;
  entity: string;
  columns: TableToolbarColumn[];
  rows: Array<{ id: string; search: string; cells: Record<string, ReactNode> }>;
  onAdd?: () => void;
  addLabel?: string;
  empty?: ReactNode;
}) {
  const prefs = useTablePrefs(tableId, columns);
  const filtered = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.search.toLowerCase().includes(query));
  }, [prefs.appliedQuery, rows]);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  return (
    <AppDataTable
      toolbar={
        <TableToolbar
          prefs={prefs}
          entity={entity}
          columns={columns}
          rowKind="dynamic"
          filteredCount={filtered.length}
          totalCount={rows.length}
          onAdd={onAdd}
          addLabel={addLabel}
        />
      }
      columns={shown.map((column) => ({ id: column.id, label: column.label }))}
      empty={filtered.length === 0 ? empty : undefined}
    >
      {filtered.map((row) => (
        <AppDataTableRow key={row.id}>
          {shown.map((column) => (
            <TableCell key={column.id}>{row.cells[column.id] ?? <EmptyCell />}</TableCell>
          ))}
        </AppDataTableRow>
      ))}
    </AppDataTable>
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
