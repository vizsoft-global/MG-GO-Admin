"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ExternalLink,
  Loader2,
  Pencil,
  Send,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { StatusPill } from "@/components/dashboard/status-pill";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptionsFrom } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import {
  addVisitBookingNote,
  fetchAdminVisitDetail,
  fetchVisitBookingNotes,
  fetchVisitSlots,
  rescheduleAdminVisit,
  updateAdminVisitStatus,
  updateVisitNoteToRider,
  type VisitDetailRow,
} from "./visits-actions";
import {
  avatarTintClass,
  departmentBadgeClass,
  initialsOf,
  visitStatusVariant,
} from "./visit-status-utils";

const SECTION_LABEL =
  "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

type StepState = "done" | "current" | "pending" | "failed";

type TimelineStep = {
  key: string;
  label: string;
  sub: string;
  state: StepState;
};

type TimelineLabels = {
  booked: string;
  confirmed: string;
  checkedIn: string;
  completed: string;
  cancelled: string;
  noShow: string;
  awaitingArrival: string;
  notStarted: string;
  skipped: string;
};

function buildTimeline(
  visit: VisitDetailRow,
  labels: TimelineLabels,
  stamp: (iso: string) => string,
): TimelineStep[] {
  // Bookings are inserted already confirmed by driver_book_visit, so "Booked" and
  // "Confirmed · slot held" share the same timestamp — there is no separate event.
  const steps: TimelineStep[] = [
    {
      key: "booked",
      label: labels.booked,
      sub: stamp(visit.created_at),
      state: "done",
    },
    {
      key: "confirmed",
      label: labels.confirmed,
      sub: stamp(visit.created_at),
      state: "done",
    },
  ];

  steps.push(
    visit.checked_in_at
      ? {
          key: "checked_in",
          label: labels.checkedIn,
          sub: stamp(visit.checked_in_at),
          state: "done",
        }
      : {
          key: "checked_in",
          label: labels.checkedIn,
          sub: visit.status === "confirmed" ? labels.awaitingArrival : labels.skipped,
          state: visit.status === "confirmed" ? "current" : "pending",
        },
  );

  if (visit.status === "cancelled") {
    steps.push({
      key: "cancelled",
      label: labels.cancelled,
      sub: stamp(visit.cancelled_at ?? visit.updated_at),
      state: "failed",
    });
    return steps;
  }

  if (visit.status === "no_show") {
    steps.push({
      key: "no_show",
      label: labels.noShow,
      sub: stamp(visit.updated_at),
      state: "failed",
    });
    return steps;
  }

  steps.push(
    visit.completed_at
      ? {
          key: "completed",
          label: labels.completed,
          sub: stamp(visit.completed_at),
          state: "done",
        }
      : {
          key: "completed",
          label: labels.completed,
          sub: labels.notStarted,
          state: visit.status === "checked_in" ? "current" : "pending",
        },
  );

  return steps;
}

function TimelineDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-success text-white">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-destructive text-white">
        <X className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-primary bg-background">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
    );
  }
  return (
    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-muted" />
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function VisitDetailPageShell({ bookingId }: { bookingId: string }) {
  const t = useTranslations("pages.visitBookings");
  const locale = useLocale();
  const { can } = useAuth();
  const canOperate = can("visits.operate");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [riderNoteOpen, setRiderNoteOpen] = useState(false);
  const [riderNoteDraft, setRiderNoteDraft] = useState("");
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleSlotId, setRescheduleSlotId] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.visits.detail(bookingId),
    queryFn: () => fetchAdminVisitDetail(bookingId),
  });

  const notesQuery = useQuery({
    queryKey: [...queryKeys.visits.detail(bookingId), "notes"],
    queryFn: () => fetchVisitBookingNotes(bookingId),
  });

  const slotsQuery = useQuery({
    queryKey: queryKeys.visits.slots(),
    queryFn: () => fetchVisitSlots(),
    enabled: rescheduleOpen,
  });

  const visit = data?.visit;

  const stamp = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  const timeline = visit
    ? buildTimeline(
        visit,
        {
          booked: t("detail.stepBooked"),
          confirmed: t("detail.stepConfirmed"),
          checkedIn: t("detail.stepCheckedIn"),
          completed: t("detail.stepCompleted"),
          cancelled: t("detail.stepCancelled"),
          noShow: t("detail.stepNoShow"),
          awaitingArrival: t("detail.stepAwaitingArrival"),
          notStarted: t("detail.stepNotStarted"),
          skipped: t("detail.stepSkipped"),
        },
        stamp,
      )
    : [];

  const slotOptions = useMemo(() => {
    if (!visit || !rescheduleDate) return [];
    const dow = new Date(`${rescheduleDate}T00:00:00`).getDay();
    const rows = (slotsQuery.data?.rows ?? []).filter(
      (s) =>
        s.is_active &&
        s.department_key === visit.department_key &&
        (s.slot_date ? s.slot_date === rescheduleDate : s.day_of_week === dow),
    );
    return selectOptionsFrom(
      rows,
      (s) => s.id,
      (s) =>
        `${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}${
          s.branch_name ? ` · ${s.branch_name}` : ""
        }`,
    );
  }, [slotsQuery.data?.rows, visit, rescheduleDate]);

  const slotLabel =
    visit?.slot_start && visit?.slot_end
      ? `${visit.slot_start.slice(0, 5)} – ${visit.slot_end.slice(0, 5)}`
      : "—";

  const actionError = (code: string | undefined) => {
    switch (code) {
      case "duplicate_department_date":
        return t("detail.errDuplicate");
      case "slot_full":
        return t("detail.errSlotFull");
      case "not_reschedulable":
        return t("detail.errNotReschedulable");
      case "slot_date_mismatch":
      case "slot_department_mismatch":
      case "slot_not_found":
        return t("detail.errSlotDateMismatch");
      case "unchanged":
        return t("detail.errUnchanged");
      default:
        return t("actionFailed");
    }
  };

  const setStatus = async (
    status: "checked_in" | "completed" | "no_show" | "cancelled",
  ) => {
    setBusy(true);
    const result = await updateAdminVisitStatus({ bookingId, status });
    setBusy(false);
    if (!result.ok) {
      toast.error(actionError(result.error));
      return;
    }
    toast.success(t("actionOk"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
    await refetch();
  };

  const submitNote = async () => {
    if (!noteDraft.trim()) return;
    setBusy(true);
    const result = await addVisitBookingNote({ bookingId, body: noteDraft });
    setBusy(false);
    if (!result.ok) {
      toast.error(actionError(result.error));
      return;
    }
    setNoteDraft("");
    toast.success(t("detail.noteAdded"));
    await notesQuery.refetch();
  };

  const saveRiderNote = async () => {
    setBusy(true);
    const result = await updateVisitNoteToRider({ bookingId, note: riderNoteDraft });
    setBusy(false);
    if (!result.ok) {
      toast.error(actionError(result.error));
      return;
    }
    setRiderNoteOpen(false);
    toast.success(t("actionOk"));
    await refetch();
  };

  const submitReschedule = async () => {
    if (!rescheduleDate || !rescheduleSlotId) return;
    setBusy(true);
    const result = await rescheduleAdminVisit({
      bookingId,
      scheduledDate: rescheduleDate,
      slotId: rescheduleSlotId,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(actionError(result.error));
      return;
    }
    setRescheduleOpen(false);
    toast.success(t("detail.rescheduleOk"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.all() });
    await refetch();
  };

  if (isLoading) {
    return (
      <AppPage>
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppPage>
    );
  }

  if (!visit) {
    return (
      <AppPage>
        <AppPageHeader title={t("detail.notFound")} />
        <Button variant="outline" className="h-9" render={<Link href="/visit-bookings" />}>
          <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
          {t("detail.back")}
        </Button>
      </AppPage>
    );
  }

  const closed =
    visit.status === "completed" ||
    visit.status === "cancelled" ||
    visit.status === "no_show";

  const scheduledDateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${visit.scheduled_date}T00:00:00`));

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("allVisits.title"), href: "/visit-bookings/all" },
          { label: visit.booking_code },
        ]}
        title={visit.booking_code}
        description={`${visit.department_label} · ${scheduledDateLabel}`}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                departmentBadgeClass(visit.department_key),
              )}
            >
              {visit.department_label}
            </span>
            <StatusPill variant={visitStatusVariant(visit.status)}>
              {t(`status.${visit.status}` as "status.confirmed")}
            </StatusPill>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/visit-bookings" />}
            >
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t("detail.back")}
            </Button>
          </div>
        }
      />

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="space-y-2">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                    avatarTintClass(visit.driver_name),
                  )}
                >
                  {initialsOf(visit.driver_name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{visit.driver_name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {visit.driver_phone ?? "—"}
                    {visit.driver_code
                      ? ` · ${t("detail.driverCode")} ${visit.driver_code}`
                      : ""}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0 text-primary hover:bg-primary/10"
                render={<Link href={`/drivers/${visit.driver_id}`} />}
              >
                <ExternalLink className="me-1.5 h-3.5 w-3.5" />
                {t("detail.viewProfile")}
              </Button>
            </div>

            <div className="mt-3 flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-3">
              <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border border-border bg-white p-1">
                <QRCodeSVG
                  value={visit.booking_code}
                  size={64}
                  level="M"
                  marginSize={0}
                />
              </span>
              <div className="min-w-0">
                <p className={SECTION_LABEL}>{t("detail.checkInCodeLabel")}</p>
                <p className="text-xl font-semibold tabular-nums tracking-tight">
                  {visit.booking_code}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("detail.checkInCodeHint")}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className={SECTION_LABEL}>{t("detail.purpose")}</p>
            <p
              className={cn(
                "mt-1 text-sm",
                !visit.note && "text-muted-foreground italic",
              )}
            >
              {visit.note || t("detail.purposeEmpty")}
            </p>

            <div className="mt-3 flex items-center justify-between gap-2">
              <p className={SECTION_LABEL}>{t("detail.noteToRider")}</p>
              {canOperate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-primary hover:bg-primary/10"
                  onClick={() => {
                    setRiderNoteDraft(visit.note_to_rider ?? "");
                    setRiderNoteOpen(true);
                  }}
                >
                  <Pencil className="me-1 h-3 w-3" />
                  {t("catalog.edit")}
                </Button>
              ) : null}
            </div>
            <p
              className={cn(
                "mt-1 text-sm",
                !visit.note_to_rider && "text-muted-foreground italic",
              )}
            >
              {visit.note_to_rider || t("detail.noteToRiderEmpty")}
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className={SECTION_LABEL}>{t("detail.visitDetails")}</p>
            <div className="mt-2 divide-y divide-border rounded-lg border border-border">
              <DetailRow label={t("detail.branch")} value={visit.branch_name ?? "—"} />
              <DetailRow label={t("colDate")} value={scheduledDateLabel} />
              <DetailRow label={t("detail.slot")} value={slotLabel} />
            </div>
          </section>
        </div>

        <div className="space-y-2">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className={SECTION_LABEL}>{t("detail.timeline")}</p>
            <ol className="mt-2 space-y-0">
              {timeline.map((step, index) => (
                <li key={step.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <TimelineDot state={step.state} />
                    {index < timeline.length - 1 ? (
                      <span className="my-0.5 w-0.5 flex-1 bg-border" />
                    ) : null}
                  </div>
                  <div className={cn("min-w-0", index < timeline.length - 1 && "pb-3")}>
                    <p
                      className={cn(
                        "text-sm leading-tight",
                        step.state === "pending"
                          ? "text-muted-foreground"
                          : "font-medium",
                      )}
                    >
                      {step.label}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {step.sub}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {canOperate && !closed ? (
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className={SECTION_LABEL}>{t("detail.actions")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {visit.status === "confirmed" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9"
                      disabled={busy}
                      onClick={() => void setStatus("checked_in")}
                    >
                      <Check className="me-1.5 h-3.5 w-3.5" />
                      {t("checkIn")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9"
                      disabled={busy}
                      onClick={() => {
                        setRescheduleDate(visit.scheduled_date);
                        setRescheduleSlotId("");
                        setRescheduleOpen(true);
                      }}
                    >
                      <CalendarClock className="me-1.5 h-3.5 w-3.5" />
                      {t("detail.reschedule")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9"
                      disabled={busy}
                      onClick={() => void setStatus("no_show")}
                    >
                      {t("noShow")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 text-destructive hover:bg-destructive/10"
                      disabled={busy}
                      onClick={() => void setStatus("cancelled")}
                    >
                      <X className="me-1.5 h-3.5 w-3.5" />
                      {t("cancel")}
                    </Button>
                  </>
                ) : null}
                {visit.status === "checked_in" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9"
                      disabled={busy}
                      onClick={() => void setStatus("completed")}
                    >
                      <Check className="me-1.5 h-3.5 w-3.5" />
                      {t("complete")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 text-destructive hover:bg-destructive/10"
                      disabled={busy}
                      onClick={() => void setStatus("cancelled")}
                    >
                      <X className="me-1.5 h-3.5 w-3.5" />
                      {t("cancel")}
                    </Button>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className={SECTION_LABEL}>{t("detail.internalNotes")}</p>
            <div className="mt-2 flex items-center gap-2">
              <Input
                className="h-9"
                value={noteDraft}
                placeholder={t("detail.internalNotePlaceholder")}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitNote();
                }}
              />
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0"
                disabled={busy || !noteDraft.trim()}
                onClick={() => void submitNote()}
              >
                <Send className="me-1.5 h-3.5 w-3.5" />
                {t("detail.addNote")}
              </Button>
            </div>

            {notesQuery.data?.rows.length ? (
              <ul className="mt-3 max-h-44 space-y-2 overflow-y-auto">
                {notesQuery.data.rows.map((note) => (
                  <li
                    key={note.id}
                    className="rounded-lg border border-border bg-muted/30 p-2"
                  >
                    <p className="text-sm">{note.body}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {note.author_name ?? "—"} · {stamp(note.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[11px] italic text-muted-foreground">
                {t("detail.internalNotesEmpty")}
              </p>
            )}
          </section>
        </div>
      </div>

      <Dialog open={riderNoteOpen} onOpenChange={setRiderNoteOpen}>
        <DialogContent
          className="overflow-visible pt-4 sm:max-w-lg"
          showCloseButton
          closeOutside
        >
          <div className="space-y-1">
            <Label className={SECTION_LABEL}>{t("detail.noteToRider")}</Label>
            <Textarea
              rows={4}
              value={riderNoteDraft}
              placeholder={t("detail.noteToRiderPlaceholder")}
              onChange={(e) => setRiderNoteDraft(e.target.value)}
            />
          </div>
          <AppModalFooter
            title={t("detail.noteToRiderTitle")}
            subtitle={t("detail.noteToRiderSubtitle")}
          >
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setRiderNoteOpen(false)}
            >
              {t("catalog.cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={busy}
              onClick={() => void saveRiderNote()}
            >
              {t("catalog.save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent
          className="overflow-visible pt-4 sm:max-w-lg"
          showCloseButton
          closeOutside
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className={SECTION_LABEL}>{t("detail.rescheduleDate")}</Label>
              <Input
                type="date"
                className="h-9"
                value={rescheduleDate}
                onChange={(e) => {
                  setRescheduleDate(e.target.value);
                  setRescheduleSlotId("");
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className={SECTION_LABEL}>{t("detail.rescheduleSlot")}</Label>
              <Select
                items={slotOptions}
                value={rescheduleSlotId}
                onValueChange={(value) => setRescheduleSlotId(value ?? "")}
                disabled={slotsQuery.isLoading || slotOptions.length === 0}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("detail.rescheduleSlot")} />
                </SelectTrigger>
                <SelectContent>
                  {slotOptions.map((slot) => (
                    <SelectItem key={slot.value} value={slot.value}>
                      {slot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rescheduleDate && !slotsQuery.isLoading && slotOptions.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  {t("detail.rescheduleNoSlots")}
                </p>
              ) : null}
            </div>
          </div>
          <AppModalFooter
            title={t("detail.rescheduleTitle")}
            subtitle={t("detail.rescheduleSubtitle")}
            meta={`${visit.booking_code} · ${visit.department_label}`}
          >
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setRescheduleOpen(false)}
            >
              {t("catalog.cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={busy || !rescheduleDate || !rescheduleSlotId}
              onClick={() => void submitReschedule()}
            >
              {t("detail.rescheduleSubmit")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
