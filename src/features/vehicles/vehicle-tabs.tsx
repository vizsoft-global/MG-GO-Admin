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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query/query-keys";
import { getSignedStorageUrl } from "@/lib/storage/storage-actions";
import type { VehicleListRow } from "./types";
import {
  createVehicleAccident,
  createVehicleDocument,
  createVehicleHandover,
  createVehicleService,
  listVehicleAccidents,
  listVehicleAssignedAssets,
  listVehicleDocuments,
  listVehicleHandovers,
  listVehicleServices,
  listVehicleTabDrivers,
} from "./vehicle-tabs-actions";

type TabId = "handover" | "accident" | "documents" | "service" | "assets";

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
  return <AssetsTab driverId={vehicle.assigned_driver_id} />;
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
        onClose={() => setOpen(false)}
        onSubmit={async (form) => {
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
        <DriverField name="fromDriverId" label={t("colFrom")} items={drivers.data ?? []} />
        <DriverField name="toDriverId" label={t("colTo")} items={drivers.data ?? []} />
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
          <Input name="occurredAt" type="datetime-local" required className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colLocation")}
          <Input name="locationText" className="h-9" />
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
  return (
    <div className="space-y-3">
      {canManage ? <AddButton onClick={() => setOpen(true)} label={t("addDocument")} /> : null}
      {rows.length === 0 ? (
        <AppEmptyState title={t("emptyDocuments")} />
      ) : (
        <TabTable
          heads={[t("colDocType"), t("colExpires"), t("colFile")]}
          rows={rows.map((row) => [
            row.doc_type,
            row.expires_at ?? "—",
            <FileLink key={row.id} storageKey={row.storage_key} />,
          ])}
        />
      )}
      <LedgerDialog
        open={open}
        title={t("addDocument")}
        subtitle={t("documentsSubtitle")}
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
          <Input name="docType" required className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("colExpires")}
          <Input name="expiresAt" type="date" className="h-9" />
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
          <Input name="servicedAt" type="date" required className="h-9" />
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

function AssetsTab({ driverId }: { driverId: string | null }) {
  const t = useTranslations("pages.vehicleDetail");
  const list = useQuery({
    queryKey: queryKeys.vehicles.tabs(driverId ?? "none", "assets"),
    queryFn: () => listVehicleAssignedAssets(driverId),
  });
  const rows = list.data ?? [];
  if (!driverId) return <AppEmptyState title={t("emptyAssetsNoDriver")} />;
  if (rows.length === 0) return <AppEmptyState title={t("emptyAssets")} />;
  return (
    <TabTable
      heads={[t("colAsset"), t("colQty"), t("colWhen")]}
      rows={rows.map((row) => [
        row.code ? `${row.name} · ${row.code}` : row.name,
        String(row.quantity),
        row.assigned_at?.slice(0, 10) ?? "—",
      ])}
    />
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
}: {
  name: string;
  label: string;
  items: Array<{ id: string; label: string }>;
}) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <label className="space-y-1 text-xs">
      {label}
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
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<string | null>;
  children: ReactNode;
}) {
  const t = useTranslations("pages.vehicles");
  const tDetail = useTranslations("pages.vehicleDetail");
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent showCloseButton closeOutside className="w-[min(1200px,96vw)] overflow-visible p-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            startTransition(async () => {
              const error = await onSubmit(form);
              if (error) toast.error(tDetail(`errors.${error}` as "errors.save_failed"));
              else toast.success(t("saved"));
            });
          }}
        >
          <div className="space-y-3 px-5 py-4">{children}</div>
          <AppModalFooter title={title} subtitle={subtitle}>
            <Button type="button" variant="outline" className="h-9" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="h-9" disabled={pending}>
              {t("save")}
            </Button>
          </AppModalFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
