"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import * as XLSX from "xlsx";
import { CalendarClock } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import {
  applyRosterSheet,
  assignStaffZones,
  importRestaurantZoneSheet,
  loadRosterThresholds,
  loadZoneStaff,
  previewRosterSheet,
  saveRosterThresholds,
} from "./roster-actions";
import { rosterError } from "./roster-result";

const TEMPLATE = [
  ["Driver Id", "Driver Name", "Store CC", "Store Name", "Date", "Day", "Shift no.", "Start Time", "End Time", "Ends Next Day", "OFF", "Notes"],
  ["10569", "Sample Rider", "CC-1", "KFC ALSHAAB", "2026-10-26", "Monday", 1, "10:00 AM", "4:00 PM", "No", "", ""],
  ["10569", "Sample Rider", "CC-1", "KFC ALSHAAB", "2026-10-26", "Monday", 2, "8:00 PM", "2:00 AM", "Yes", "", "covering another branch"],
];

function sheetFromFile(file: File): Promise<unknown[][]> {
  return file.arrayBuffer().then((buffer) => {
    const book = XLSX.read(buffer, { type: "array", cellDates: true });
    const name = book.SheetNames[0];
    if (!name) return [];
    return XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true }) as unknown[][];
  });
}

export function RosterPageShell() {
  const t = useTranslations("pages.roster");
  const { can } = useAuth();
  const canManage = can("attendance.manage");
  const canZones = can("zones.manage");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [aoa, setAoa] = useState<unknown[][] | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewRosterSheet>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [zoneIds, setZoneIds] = useState<string[]>([]);

  const thresholds = useQuery({
    queryKey: ["roster", "thresholds"],
    queryFn: () => loadRosterThresholds(),
  });
  const staff = useQuery({
    queryKey: ["roster", "staff"],
    queryFn: () => loadZoneStaff(),
    enabled: canZones,
  });

  const settings = thresholds.data && "lateGraceMinutes" in thresholds.data ? thresholds.data : null;
  const staffData = staff.data && "staff" in staff.data ? staff.data : null;

  async function onSaveThresholds(form: FormData) {
    setBusy(true);
    const result = await saveRosterThresholds({
      lateGraceMinutes: Number(form.get("late")),
      earlyGraceMinutes: Number(form.get("early")),
      nearMeters: Number(form.get("near")),
      minMinutes: Number(form.get("minutes")),
      flagMissingProof: form.get("proof") === "on",
    });
    setBusy(false);
    const code = rosterError(result);
    setMessage(code ? t(`errors.${code}`) : t("saved"));
    await queryClient.invalidateQueries({ queryKey: ["roster", "thresholds"] });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="type-h1 flex items-center gap-2">
            <CalendarClock className="size-5" aria-hidden />
            {t("title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-9" nativeButton={false} render={<Link href="/operations/roster/alerts" />}>
            {t("alerts")}
          </Button>
          <Button variant="outline" className="h-9" nativeButton={false} render={<Link href="/operations/roster/report" />}>
            {t("report")}
          </Button>
          {canManage ? (
            <Button className="h-9" onClick={() => setOpen(true)}>
              {t("upload")}
            </Button>
          ) : null}
        </div>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}

      {settings && canManage ? (
        <form action={onSaveThresholds} className="grid gap-2 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-2">
          <p className="text-sm font-semibold md:col-span-2">{t("thresholds")}</p>
          <label className="space-y-1 text-xs">
            {t("lateGrace")}
            <Input name="late" type="number" min={0} defaultValue={settings.lateGraceMinutes} className="h-9" />
          </label>
          <label className="space-y-1 text-xs">
            {t("earlyGrace")}
            <Input name="early" type="number" min={0} defaultValue={settings.earlyGraceMinutes} className="h-9" />
          </label>
          <label className="space-y-1 text-xs">
            {t("nearMeters")}
            <Input name="near" type="number" min={0} defaultValue={settings.nearMeters} className="h-9" />
          </label>
          <label className="space-y-1 text-xs">
            {t("minMinutes")}
            <Input name="minutes" type="number" min={0} defaultValue={settings.minMinutes} className="h-9" />
          </label>
          <label className="flex items-center gap-2 text-xs md:col-span-2">
            <input name="proof" type="checkbox" defaultChecked={settings.flagMissingProof} />
            {t("missingProof")}
          </label>
          <Button type="submit" className="h-9 w-fit" disabled={busy}>
            {t("save")}
          </Button>
        </form>
      ) : null}

      {canZones && staffData ? (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-sm font-semibold">{t("staff")}</p>
          <SearchSelect
            items={staffData.staff.map((person) => ({ value: person.id, label: person.name, keywords: [person.name] }))}
            value={staffId}
            onChange={(value) => {
              setStaffId(value);
              const person = staffData.staff.find((row) => row.id === value);
              setZoneIds(person?.zoneIds ?? []);
            }}
            className="h-9"
            placeholder={t("staff")}
            searchPlaceholder={t("staff")}
            recentsKey="roster-zone-staff"
          />
          <div className="flex flex-wrap gap-2">
            {staffData.zones.map((zone) => (
              <ToggleChip
                key={zone.id}
                selected={zoneIds.includes(zone.id)}
                onClick={() =>
                  setZoneIds((current) =>
                    current.includes(zone.id) ? current.filter((id) => id !== zone.id) : [...current, zone.id],
                  )
                }
              >
                {zone.name}
              </ToggleChip>
            ))}
          </div>
          <Button
            className="h-9"
            disabled={!staffId || busy}
            onClick={async () => {
              if (!staffId) return;
              setBusy(true);
              const result = await assignStaffZones(staffId, zoneIds);
              setBusy(false);
              const code = rosterError(result);
              setMessage(code ? t(`errors.${code}`) : t("saved"));
              await queryClient.invalidateQueries({ queryKey: ["roster", "staff"] });
            }}
          >
            {t("save")}
          </Button>
          <label className="block space-y-1 text-xs">
            {t("restaurantImport")}
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="h-9"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setBusy(true);
                const result = await importRestaurantZoneSheet(await sheetFromFile(file));
                setBusy(false);
                const code = rosterError(result);
                setMessage(
                  code
                    ? t(`errors.${code}`)
                    : "written" in result && Array.isArray(result.failed)
                      ? `${t("written")} ${result.written} · ${t("failed")} ${result.failed.length}`
                      : t("errors.not_configured"),
                );
              }}
            />
          </label>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton closeOutside className="w-[min(1200px,96vw)]">
          <div className="max-h-[min(70dvh,560px)] space-y-3 overflow-y-auto px-5 py-4">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => downloadWorkbookXlsx("schedule-upload.xlsx", [{ name: "Schedule Upload", aoa: TEMPLATE }])}
            >
              {t("template")}
            </Button>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="h-9"
              aria-label={t("chooseFile")}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const rows = await sheetFromFile(file);
                setAoa(rows);
                setBusy(true);
                setPreview(await previewRosterSheet(rows));
                setBusy(false);
              }}
            />
            {preview && rosterError(preview) ? (
              <p className="text-xs text-destructive">{t(`errors.${rosterError(preview)}`)}</p>
            ) : null}
            {preview && "ready" in preview ? (
              <p className="text-xs">
                {t("ready")} {preview.ready} · {t("failed")} {preview.failed}
              </p>
            ) : null}
            {preview && "ready" in preview
              ? (preview.rows ?? []).slice(0, 12).map((row) => (
                  <p key={`${row.driverKey}-${row.date}-${row.rows.join("-")}`} className="truncate text-xs">
                    {row.driverLabel || row.driverKey} · {row.date} · {row.off ? t("statuses.off") : row.storeName}
                    {row.errors.length ? ` · ${row.errors.map((code) => t(`errors.${code}`)).join(", ")}` : ""}
                  </p>
                ))
              : null}
          </div>
          <AppModalFooter title={t("upload")} subtitle={t("subtitle")}>
            <Button variant="outline" className="h-9" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              className="h-9"
              disabled={busy || !aoa || !preview || !("ready" in preview) || preview.ready === 0}
              onClick={async () => {
                if (!aoa) return;
                setBusy(true);
                const result = await applyRosterSheet(aoa);
                setBusy(false);
                const code = rosterError(result);
                setMessage(
                  code
                    ? t(`errors.${code}`)
                    : "written" in result
                      ? `${t("written")} ${result.written} · ${t("failed")} ${result.failed}`
                      : t("errors.not_configured"),
                );
                setOpen(false);
              }}
            >
              {t("apply")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
