"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query/query-keys";
import { DEFAULT_ODOMETER_SYNC_CONFIG, type OdometerSyncConfig } from "./types";
import {
  saveOdometerSyncConfig,
  testOdometerSyncConnection,
  type OdometerTestResult,
} from "./service-actions";
import { serviceErrorKey, useOdometerSyncConfig } from "./use-service";

type FormState = Omit<
  OdometerSyncConfig,
  "last_run_at" | "last_run_summary" | "secret_configured"
>;

/**
 * The dashcam odometer feed settings.
 *
 * The vendor's published spec answers 500 from outside their network, so the
 * endpoint shape ships as **configuration**: the operator fills the paths and the
 * field names here, presses **Test connection**, and reads the raw first row the
 * endpoint returned. That is how the real names are settled without a deploy, and
 * it is the only honest way to prove a credential before the four-times-a-day
 * sync is switched on.
 */
export function ServiceOdometerSyncDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const config = useOdometerSyncConfig();
  const loaded: OdometerSyncConfig = config.data ?? { ...DEFAULT_ODOMETER_SYNC_CONFIG };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(680px,96vw)]">
        {/* Keyed on the stored configuration: the form is mounted once the read
            lands, and remounts when the saved values change, so nothing is
            synchronised through an effect. */}
        <SyncForm
          key={JSON.stringify(loaded)}
          loaded={loaded}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function SyncForm({ loaded, onClose }: { loaded: OdometerSyncConfig; onClose: () => void }) {
  const t = useTranslations("pages.fleetService");
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    enabled: loaded.enabled,
    base_url: loaded.base_url,
    auth_mode: loaded.auth_mode,
    app_cid: loaded.app_cid,
    vehicles_path: loaded.vehicles_path,
    vehicle_path: loaded.vehicle_path,
    odometer_field: loaded.odometer_field,
    plate_field: loaded.plate_field,
    chassis_field: loaded.chassis_field,
  });
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<OdometerTestResult | null>(null);

  function patch(next: Partial<FormState>) {
    setForm((current) => ({ ...current, ...next }));
  }

  async function save() {
    setBusy(true);
    const result = await saveOdometerSyncConfig(form);
    setBusy(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("saved"));
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.odometerSync() });
  }

  async function runTest() {
    setBusy(true);
    setTest(null);
    const result = await testOdometerSyncConnection();
    setBusy(false);
    setTest(result);
  }

  return (
    <>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 pt-4 pb-2">
        <p className="text-sm text-muted-foreground">{t("odometerSync.hint")}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={form.enabled ? "default" : "outline"}
            className="h-9"
            onClick={() => patch({ enabled: !form.enabled })}
          >
            {form.enabled ? t("odometerSync.enabled") : t("odometerSync.disabled")}
          </Button>
          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
            {t("odometerSync.cadence")}
          </Badge>
          {loaded.last_run_at ? (
            <span className="text-xs text-muted-foreground">
              {t("odometerSync.lastRun", { at: loaded.last_run_at })}
            </span>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block font-medium">{t("odometerSync.baseUrl")}</span>
            <Input
              className="h-9"
              value={form.base_url}
              placeholder="https://vssgpsmea.live/api"
              onChange={(event) => patch({ base_url: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("odometerSync.authMode")}</span>
            <Select
              items={[
                { value: "headers", label: t("odometerSync.modeHeaders") },
                { value: "login", label: t("odometerSync.modeLogin") },
              ]}
              value={form.auth_mode}
              onValueChange={(next) =>
                patch({ auth_mode: (next ?? "headers") as "headers" | "login" })
              }
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="headers">{t("odometerSync.modeHeaders")}</SelectItem>
                <SelectItem value="login">{t("odometerSync.modeLogin")}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("odometerSync.appCid")}</span>
            <Input
              className="h-9"
              value={form.app_cid}
              onChange={(event) => patch({ app_cid: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("odometerSync.appSecret")}</span>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-2">
              <Badge
                variant="outline"
                className={
                  loaded.secret_configured
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }
              >
                {loaded.secret_configured
                  ? t("odometerSync.secretPresent")
                  : t("odometerSync.secretMissing")}
              </Badge>
              <span className="text-muted-foreground">{t("odometerSync.secretHint")}</span>
            </div>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("odometerSync.vehiclesPath")}</span>
            <Input
              className="h-9"
              value={form.vehicles_path}
              onChange={(event) => patch({ vehicles_path: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("odometerSync.odometerField")}</span>
            <Input
              className="h-9"
              value={form.odometer_field}
              onChange={(event) => patch({ odometer_field: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("odometerSync.plateField")}</span>
            <Input
              className="h-9"
              value={form.plate_field}
              onChange={(event) => patch({ plate_field: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("odometerSync.chassisField")}</span>
            <Input
              className="h-9"
              value={form.chassis_field}
              onChange={(event) => patch({ chassis_field: event.target.value })}
            />
          </label>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-2 text-xs">
          {test === null ? (
            <span className="text-muted-foreground">{t("odometerSync.testHint")}</span>
          ) : "ok" in test ? (
            <>
              <div className="font-medium text-emerald-700">
                {t("odometerSync.testOk", { status: test.status, rows: test.rows })}
              </div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                {JSON.stringify(test.sample, null, 2)}
              </pre>
            </>
          ) : (
            <div className="text-rose-700">
              {t("odometerSync.testFailed", {
                code: test.error,
                message: test.message ?? "",
              })}
            </div>
          )}
        </div>
      </div>
      <AppModalFooter title={t("odometerSync.title")}>
        <Button
          type="button"
          variant="outline"
          className="h-9"
          disabled={busy}
          onClick={() => void runTest()}
        >
          {t("odometerSync.test")}
        </Button>
        <Button type="button" variant="outline" className="h-9" onClick={onClose}>
          {t("actions.close")}
        </Button>
        <Button type="button" className="h-9" disabled={busy} onClick={() => void save()}>
          {t("actions.save")}
        </Button>
      </AppModalFooter>
    </>
  );
}
