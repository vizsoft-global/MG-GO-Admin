"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Loader2, Minus, Plus, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptionsFrom } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import {
  addVisitBlockedDate,
  fetchVisitBlockedDates,
  fetchVisitBookingConfigs,
  fetchVisitDepartments,
  removeVisitBlockedDate,
  saveVisitBookingConfig,
  updateVisitDepartmentDesks,
  type VisitBookingConfigRow,
} from "./visits-actions";
import { DAY_OF_WEEK_LABELS } from "./visit-status-utils";

const SLOT_LENGTH_OPTIONS = [15, 20, 30, 45, 60];
const BUFFER_OPTIONS = [0, 5, 10, 15];
const CAPACITY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];
const BOOKING_WINDOW_OPTIONS = [7, 14, 21, 30, 60];

const FIELD_LABEL_CLASS =
  "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

type ConfigDraft = {
  working_dows: number[];
  opening_time: string;
  closing_time: string;
  lunch_start: string;
  lunch_end: string;
  slot_length_minutes: number;
  slot_buffer_minutes: number;
  default_slot_capacity: number;
  booking_window_days: number;
};

function hhmm(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

function draftFromConfig(config: VisitBookingConfigRow): ConfigDraft {
  return {
    working_dows: [...config.working_dows],
    opening_time: hhmm(config.opening_time),
    closing_time: hhmm(config.closing_time),
    lunch_start: hhmm(config.lunch_start),
    lunch_end: hhmm(config.lunch_end),
    slot_length_minutes: config.slot_length_minutes,
    slot_buffer_minutes: config.slot_buffer_minutes,
    default_slot_capacity: config.default_slot_capacity,
    booking_window_days: config.booking_window_days,
  };
}

function SettingsCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", className)}
    >
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function VisitsSlotsShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canManage = can("visits.manage_catalog");
  const queryClient = useQueryClient();

  const [branchId, setBranchId] = useState<string | null>(null);
  const [draftOverride, setDraftOverride] = useState<{
    branchId: string;
    value: ConfigDraft;
  } | null>(null);
  const [deskOverride, setDeskOverride] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedDate, setBlockedDate] = useState("");
  const [blockedReason, setBlockedReason] = useState("");

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: queryKeys.visits.list({ bookingConfig: true }),
    queryFn: fetchVisitBookingConfigs,
  });
  const { data: deptData } = useQuery({
    queryKey: queryKeys.visits.departments(),
    queryFn: fetchVisitDepartments,
  });
  const { data: blockedData } = useQuery({
    queryKey: queryKeys.visits.list({ blockedDates: true }),
    queryFn: fetchVisitBlockedDates,
  });

  const configs = useMemo(() => configData?.rows ?? [], [configData?.rows]);
  const activeConfig = useMemo(
    () => configs.find((c) => c.branch_id === branchId) ?? configs[0] ?? null,
    [configs, branchId],
  );
  const departments = useMemo(
    () => (deptData?.rows ?? []).filter((d) => d.is_active),
    [deptData?.rows],
  );

  const branchItems = useMemo(
    () =>
      selectOptionsFrom(
        configs,
        (c) => c.branch_id,
        (c) => c.branch_name,
      ),
    [configs],
  );
  const slotLengthItems = useMemo(
    () =>
      selectOptionsFrom(
        SLOT_LENGTH_OPTIONS,
        (minutes) => String(minutes),
        (minutes) => t("slots.minutesValue", { minutes }),
      ),
    [t],
  );
  const bufferItems = useMemo(
    () =>
      selectOptionsFrom(
        BUFFER_OPTIONS,
        (minutes) => String(minutes),
        (minutes) => t("slots.minutesValue", { minutes }),
      ),
    [t],
  );
  const capacityItems = useMemo(
    () =>
      selectOptionsFrom(
        CAPACITY_OPTIONS,
        (count) => String(count),
        (count) => t("slots.ridersValue", { count }),
      ),
    [t],
  );
  const bookingWindowItems = useMemo(
    () =>
      selectOptionsFrom(
        BOOKING_WINDOW_OPTIONS,
        (days) => String(days),
        (days) => t("slots.daysAheadValue", { days }),
      ),
    [t],
  );

  const draft = useMemo(() => {
    if (!activeConfig) return null;
    if (draftOverride && draftOverride.branchId === activeConfig.branch_id) {
      return draftOverride.value;
    }
    return draftFromConfig(activeConfig);
  }, [activeConfig, draftOverride]);

  const desks = useMemo(
    () =>
      Object.fromEntries(
        departments.map((d) => [d.id, deskOverride[d.id] ?? d.desks_count]),
      ) as Record<string, number>,
    [departments, deskOverride],
  );

  const setDraft = (
    updater: (current: ConfigDraft | null) => ConfigDraft | null,
  ) => {
    if (!activeConfig) return;
    const next = updater(draft);
    if (next) setDraftOverride({ branchId: activeConfig.branch_id, value: next });
  };

  const setDesks = (
    updater: (current: Record<string, number>) => Record<string, number>,
  ) => {
    setDeskOverride(updater(desks));
  };

  const blockedRows = useMemo(() => {
    const rows = blockedData?.rows ?? [];
    if (!activeConfig) return rows;
    return rows.filter(
      (row) => row.branch_id == null || row.branch_id === activeConfig.branch_id,
    );
  }, [blockedData?.rows, activeConfig]);

  const deskDirty = departments.some((d) => desks[d.id] !== d.desks_count);
  const configDirty = useMemo(() => {
    if (!activeConfig || !draft) return false;
    const original = draftFromConfig(activeConfig);
    return JSON.stringify(original) !== JSON.stringify(draft);
  }, [activeConfig, draft]);
  const dirty = configDirty || deskDirty;

  const resetDraft = () => {
    setDraftOverride(null);
    setDeskOverride({});
  };

  const toggleDow = (dow: number) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            working_dows: d.working_dows.includes(dow)
              ? d.working_dows.filter((v) => v !== dow)
              : [...d.working_dows, dow].sort((a, b) => a - b),
          }
        : d,
    );
  };

  const save = async () => {
    if (!activeConfig || !draft) return;
    if (!draft.opening_time || !draft.closing_time) {
      toast.error(t("slots.hoursRequired"));
      return;
    }
    setSaving(true);
    const result = await saveVisitBookingConfig({
      branch_id: activeConfig.branch_id,
      working_dows: draft.working_dows,
      opening_time: draft.opening_time,
      closing_time: draft.closing_time,
      lunch_start: draft.lunch_start || null,
      lunch_end: draft.lunch_end || null,
      slot_length_minutes: draft.slot_length_minutes,
      slot_buffer_minutes: draft.slot_buffer_minutes,
      default_slot_capacity: draft.default_slot_capacity,
      booking_window_days: draft.booking_window_days,
    });

    if (!result.ok) {
      setSaving(false);
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }

    for (const dept of departments) {
      const next = desks[dept.id];
      if (next === dept.desks_count) continue;
      const deskResult = await updateVisitDepartmentDesks({
        id: dept.id,
        desks_count: next,
      });
      if (!deskResult.ok) {
        setSaving(false);
        toast.error(deskResult.error ?? t("catalog.saveFailed"));
        return;
      }
    }

    setSaving(false);
    toast.success(t("catalog.saved"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
  };

  const addBlocked = async () => {
    if (!blockedDate) {
      toast.error(t("slots.blockedDateRequired"));
      return;
    }
    setSaving(true);
    const result = await addVisitBlockedDate({
      branch_id: activeConfig?.branch_id ?? null,
      blocked_date: blockedDate,
      reason: blockedReason,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }
    setBlockedOpen(false);
    setBlockedDate("");
    setBlockedReason("");
    toast.success(t("catalog.saved"));
    await queryClient.invalidateQueries({
      queryKey: queryKeys.visits.list({ blockedDates: true }),
    });
  };

  const removeBlocked = async (id: string) => {
    setSaving(true);
    const result = await removeVisitBlockedDate(id);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: queryKeys.visits.list({ blockedDates: true }),
    });
  };

  return (
    <AppPage className="space-y-3">
      <AppPageHeader
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("slots.title") },
        ]}
        title={t("slots.title")}
        description={t("slots.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {configs.length > 0 ? (
              <Select
                items={branchItems}
                value={activeConfig?.branch_id ?? undefined}
                onValueChange={(v) => v && setBranchId(v)}
              >
                <SelectTrigger className="h-9 w-[200px]">
                  <Building2 className="me-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder={t("detail.branch")} />
                </SelectTrigger>
                <SelectContent>
                  {branchItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={!dirty || saving}
              onClick={resetDraft}
            >
              {t("catalog.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={!canManage || !dirty || saving}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {t("slots.saveChanges")}
            </Button>
          </div>
        }
      />

      {configLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !activeConfig || !draft ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
          {t("slots.noBranchesDescription")}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3 lg:items-start">
          <div className="space-y-3 lg:col-span-2">
            <SettingsCard title={t("slots.workingDaysTitle")}>
              <div className="flex flex-wrap gap-1.5">
                {DAY_OF_WEEK_LABELS.map((label, dow) => (
                  <ToggleChip
                    key={label}
                    size="md"
                    selected={draft.working_dows.includes(dow)}
                    disabled={!canManage}
                    onClick={() => toggleDow(dow)}
                  >
                    {label}
                  </ToggleChip>
                ))}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className={FIELD_LABEL_CLASS}>{t("slots.openingTime")}</Label>
                  <Input
                    type="time"
                    className="h-9"
                    disabled={!canManage}
                    value={draft.opening_time}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, opening_time: e.target.value } : d))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className={FIELD_LABEL_CLASS}>{t("slots.closingTime")}</Label>
                  <Input
                    type="time"
                    className="h-9"
                    disabled={!canManage}
                    value={draft.closing_time}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, closing_time: e.target.value } : d))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className={FIELD_LABEL_CLASS}>{t("slots.lunchBreak")}</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="time"
                      className="h-9"
                      disabled={!canManage}
                      value={draft.lunch_start}
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, lunch_start: e.target.value } : d))
                      }
                    />
                    <span className="text-xs text-muted-foreground">–</span>
                    <Input
                      type="time"
                      className="h-9"
                      disabled={!canManage}
                      value={draft.lunch_end}
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, lunch_end: e.target.value } : d))
                      }
                    />
                  </div>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard title={t("slots.capacityTitle")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className={FIELD_LABEL_CLASS}>{t("slots.slotLength")}</Label>
                  <Select
                    items={slotLengthItems}
                    value={String(draft.slot_length_minutes)}
                    onValueChange={(v) =>
                      v &&
                      setDraft((d) => (d ? { ...d, slot_length_minutes: Number(v) } : d))
                    }
                  >
                    <SelectTrigger className="h-9" disabled={!canManage}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {slotLengthItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className={FIELD_LABEL_CLASS}>{t("slots.capacityPerSlot")}</Label>
                  <Select
                    items={capacityItems}
                    value={String(draft.default_slot_capacity)}
                    onValueChange={(v) =>
                      v &&
                      setDraft((d) => (d ? { ...d, default_slot_capacity: Number(v) } : d))
                    }
                  >
                    <SelectTrigger className="h-9" disabled={!canManage}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {capacityItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className={FIELD_LABEL_CLASS}>{t("slots.bufferBetween")}</Label>
                  <Select
                    items={bufferItems}
                    value={String(draft.slot_buffer_minutes)}
                    onValueChange={(v) =>
                      v &&
                      setDraft((d) => (d ? { ...d, slot_buffer_minutes: Number(v) } : d))
                    }
                  >
                    <SelectTrigger className="h-9" disabled={!canManage}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {bufferItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className={FIELD_LABEL_CLASS}>{t("slots.bookingWindow")}</Label>
                  <Select
                    items={bookingWindowItems}
                    value={String(draft.booking_window_days)}
                    onValueChange={(v) =>
                      v &&
                      setDraft((d) => (d ? { ...d, booking_window_days: Number(v) } : d))
                    }
                  >
                    <SelectTrigger className="h-9" disabled={!canManage}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {bookingWindowItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SettingsCard>
          </div>

          <div className="space-y-3">
            <SettingsCard title={t("slots.desksPerDepartment")}>
              {departments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("departments.emptyDescription")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {departments.map((dept) => (
                    <li
                      key={dept.id}
                      className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0"
                    >
                      <span className="truncate text-sm text-foreground">
                        {dept.label_en}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!canManage || (desks[dept.id] ?? 0) <= 0}
                          onClick={() =>
                            setDesks((d) => ({
                              ...d,
                              [dept.id]: Math.max(0, (d[dept.id] ?? 0) - 1),
                            }))
                          }
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">
                          {desks[dept.id] ?? dept.desks_count}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!canManage}
                          onClick={() =>
                            setDesks((d) => ({
                              ...d,
                              [dept.id]: (d[dept.id] ?? 0) + 1,
                            }))
                          }
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SettingsCard>

            <SettingsCard title={t("slots.blockedDatesTitle")}>
              {blockedRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("slots.blockedDatesEmpty")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {blockedRows.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold tabular-nums text-foreground">
                          {row.blocked_date}
                        </span>
                        {row.reason ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {row.reason}
                          </span>
                        ) : null}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10"
                        disabled={!canManage || saving}
                        aria-label={t("slots.removeBlockedDate")}
                        onClick={() => void removeBlocked(row.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 h-9 w-full border-dashed"
                  onClick={() => setBlockedOpen(true)}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t("slots.addBlockedDate")}
                </Button>
              ) : null}
            </SettingsCard>
          </div>
        </div>
      )}

      <Dialog open={blockedOpen} onOpenChange={setBlockedOpen}>
        <DialogContent className="overflow-visible pt-4" showCloseButton closeOutside>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className={FIELD_LABEL_CLASS}>{t("slots.blockedDate")}</Label>
              <Input
                type="date"
                className="h-9"
                value={blockedDate}
                onChange={(e) => setBlockedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className={FIELD_LABEL_CLASS}>{t("slots.blockedReason")}</Label>
              <Input
                className="h-9"
                value={blockedReason}
                placeholder={t("slots.blockedReasonPlaceholder")}
                onChange={(e) => setBlockedReason(e.target.value)}
              />
            </div>
          </div>

          <AppModalFooter
            title={t("slots.addBlockedDate")}
            subtitle={t("slots.blockedModalSubtitle")}
          >
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setBlockedOpen(false)}
            >
              {t("catalog.cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={saving}
              onClick={() => void addBlocked()}
            >
              {t("catalog.save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
