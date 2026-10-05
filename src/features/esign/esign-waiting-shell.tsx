"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BellRing,
  CircleSlash,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppDataTable, AppDataTableRow, TableCell } from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { cn } from "@/lib/utils";
import { EsignKpiStrip } from "./esign-kpi-strip";
import { EsignRemindDialog, type EsignRemindTarget } from "./esign-remind-dialog";
import { esignRecipientStage } from "./esign-recipient-stage";
import { remindEligibility } from "./esign-tracker";
import {
  useEsignReminderState,
  useEsignRequestsList,
  useEsignStatusCounts,
  useRemindEsignRequests,
} from "./use-esign";
import type { EsignListRow } from "./types";

/**
 * Waiting — reference panel F6, and the one screen in E-Sign that answers "who
 * is holding my document?".
 *
 * The Sent list is organised by the *document*: what was sent, when, to how many
 * people. This screen is organised by the **recipient's next action**, which is
 * the question an operator actually arrives with, and the two halves of
 * `pending` are the whole point of it:
 *
 * - **Not opened** — the rider has not seen the document. A reminder fires one
 *   more notification at a phone that has already ignored one, so the honest
 *   next step is usually a phone call; the count in this tab is the call list.
 * - **Opened, not signed** — the rider read it and stopped. That is the bucket a
 *   reminder reaches.
 *
 * Both are drawn from `admin_list_esign_requests` through the two derived
 * `p_status` values (`opened` / `not_opened`), so the server does the splitting
 * and this screen never holds the whole table to filter it. A third tab —
 * *All waiting* — is `p_status = 'pending'`, which is exactly the two halves
 * together and therefore has to be read rather than added: expiry is decided by
 * the server (an overdue-but-unopened row is `expired`, not `not_opened`), and a
 * client that summed its own counts would quietly include rows the server had
 * already moved out of the operator's outstanding work.
 *
 * A reminder is a **notification**, so its limit is per recipient rather than
 * per screen: the cooldown arrives from `admin_esign_reminder_state` beside the
 * stored `last_reminded_at`, which is what makes two operators looking at the
 * same rider agree about the button. `remindEligibility` re-states the rule for
 * the rows whose state has not landed yet, and the server refuses an inside-window
 * id regardless — a disabled button is a hint, not the lock.
 */
export type WaitingTab = "all" | "not_opened" | "opened";

/**
 * The tab ids, kept as a value rather than only as a type so the `TabBar`
 * callback can be **narrowed instead of cast**. The bar hands back a plain
 * string, and `id as WaitingTab` would accept any future id the bar grows and
 * silently read `TAB_STATUS[undefined]` as the filter.
 */
const WAITING_TABS: readonly WaitingTab[] = ["all", "not_opened", "opened"];

function isWaitingTab(id: string): id is WaitingTab {
  return (WAITING_TABS as readonly string[]).includes(id);
}

/**
 * Which `p_status` each tab reads.
 *
 * `all` is `pending` — the *effective* status, so it means "still in flight",
 * not "the enum member is pending". That is the same derivation the tiles above
 * are built from, which is what keeps the tab badge and the KPI from describing
 * different populations.
 */
const TAB_STATUS: Record<WaitingTab, "pending" | "opened" | "not_opened"> = {
  all: "pending",
  not_opened: "not_opened",
  opened: "opened",
};

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** The Kuwait calendar day of a wire timestamp, `YYYY-MM-DD`. */
function kuwaitYmd(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The tab the screen opens on.
 *
 * Two doors lead here — `/employeedesk/esign/waiting` ("who is holding my
 * document", opens on All so the operator sees both halves at once) and
 * `/employeedesk/esign/signing` ("what still has to be signed", which opens on
 * Not opened because an unopened document is the one a reminder cannot reach).
 * The door picks the opening tab; what the operator clicks afterwards is theirs,
 * exactly like `RequestsPageShell`'s seeded status.
 */
export function EsignWaitingShell({
  initialTab = "all",
}: {
  initialTab?: WaitingTab;
} = {}) {
  const t = useTranslations("pages.requests.esign.waiting");
  const tHub = useTranslations("pages.requests.esign.hub");
  const router = useRouter();

  const [tab, setTab] = useState<WaitingTab>(initialTab);
  const [remindOpen, setRemindOpen] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const listFilters = useMemo(() => ({ status: TAB_STATUS[tab] }), [tab]);
  const { data, isLoading, isFetching, refetch } = useEsignRequestsList(listFilters);
  const { data: counts } = useEsignStatusCounts();
  const remind = useRemindEsignRequests();

  const rows = useMemo<EsignListRow[]>(() => data?.rows ?? [], [data?.rows]);
  const ids = useMemo(() => rows.map((row) => row.id).sort(), [rows]);
  const { data: reminderData } = useEsignReminderState(ids);
  const state = reminderData?.state;

  // Read once, at mount, through a state initialiser — the one place React's
  // purity rule sanctions reading a clock. Staleness is harmless here because the
  // authoritative cooldown is the server's `hours_left`; this value only covers
  // the rows that have not received one yet, and a 24-hour window does not move
  // measurably in a page's lifetime.
  const [nowMs] = useState(() => Date.now());
  const byId = useMemo(() => {
    const map = new Map<string, { hoursLeft: number; reminderCount: number }>();
    for (const row of state?.rows ?? []) {
      map.set(row.id, { hoursLeft: row.hours_left, reminderCount: row.reminder_count });
    }
    return map;
  }, [state]);

  /**
   * The cooldown badge reads the server's number when it has arrived and falls
   * back to the pure rule otherwise. Both are the same 24h window; the fallback
   * exists so the first paint does not offer a reminder on a row that was
   * chased an hour ago by a colleague.
   */
  const cooldownLeft = (row: EsignListRow) => {
    const fromServer = byId.get(row.id)?.hoursLeft;
    if (fromServer != null) return fromServer;
    return remindEligibility(row, row.last_reminded_at ?? null, nowMs).hoursLeft;
  };

  const tabs = [
    { id: "all", label: `${t("tabAll")} (${counts?.pending ?? rows.length})` },
    { id: "not_opened", label: `${t("tabNotOpened")} (${counts?.notOpened ?? 0})` },
    { id: "opened", label: `${t("tabOpened")} (${counts?.opened ?? 0})` },
  ];

  /**
   * The drawer is handed the *not-opened* rows only.
   *
   * It filters to the two waiting stages itself, so passing everything would
   * work — and would ask the operator to read a list that mixes the bucket they
   * can reach with the bucket they cannot. "Remind all not opened" naming its
   * own population is the promise the button makes.
   */
  const notOpenedTargets = useMemo<EsignRemindTarget[]>(
    () =>
      rows
        .filter((row) => esignRecipientStage(row) === "not_opened")
        .map((row) => ({
          id: row.id,
          request_code: row.request_code,
          status: row.status,
          viewed_at: row.viewed_at,
          label: row.driver_name,
        })),
    [rows],
  );

  async function remindOne(row: EsignListRow) {
    setSendingId(row.id);
    const result = await remind.mutateAsync([row.id]);
    setSendingId(null);
    if (!result.ok) {
      toast.error(result.error ?? t("remindFailed"));
      return;
    }
    if (result.sent === 0) {
      toast.warning(t("cooldownToast", { hours: result.cooldownHours }));
      return;
    }
    toast.success(t("reminded", { count: result.sent }));
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              render={<Link href="/requests/esign" />}
            >
              {t("back")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 cursor-pointer"
              disabled={notOpenedTargets.length === 0}
              onClick={() => setRemindOpen(true)}
            >
              <BellRing className="me-1.5 h-3.5 w-3.5" />
              {t("remindAllNotOpened")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
              {t("refresh")}
            </Button>
          </div>
        }
      />

      <EsignKpiStrip
        items={[
          {
            label: t("kpiWaiting"),
            value: counts?.pending ?? "—",
            icon: Clock,
            accent: "warning",
            caption: t("kpiWaitingCaption"),
          },
          {
            label: t("kpiNotOpened"),
            value: counts?.notOpened ?? "—",
            icon: EyeOff,
            accent: "danger",
            caption: t("kpiNotOpenedCaption"),
          },
          {
            label: t("kpiOpened"),
            value: counts?.opened ?? "—",
            icon: Eye,
            accent: "primary",
            caption: t("kpiOpenedCaption"),
          },
          {
            label: t("kpiExpired"),
            value: counts?.expired ?? "—",
            icon: CircleSlash,
            accent: "default",
            caption: t("kpiExpiredCaption"),
          },
        ]}
      />

      <AppListCard className="p-0">
        <div className="border-b border-border p-2">
          <TabBar
            items={tabs}
            activeId={tab}
            onSelect={(id) => {
              if (isWaitingTab(id)) setTab(id);
            }}
          />
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data?.error ? (
          <AppEmptyState title={t("emptyTitle")} description={data.error} />
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={t("emptyTitle")}
            description={tab === "all" ? t("emptyDescription") : t("emptyFiltered")}
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: t("colCode") },
              { id: "driver", label: t("colDriver") },
              { id: "document", label: t("colDocument") },
              { id: "stage", label: t("colStage") },
              { id: "due", label: t("colDue") },
              { id: "reminded", label: t("colReminded") },
              { id: "actions", label: t("colActions"), className: "text-end" },
            ]}
          >
            {rows.map((row) => {
              const stage = esignRecipientStage(row);
              const info = byId.get(row.id);
              const hoursLeft = cooldownLeft(row);
              const cooling = hoursLeft > 0;
              const sentYmd = kuwaitYmd(row.sent_at);
              const todayYmd = kuwaitTodayYmd();
              const ageDays = sentYmd ? daysBetween(sentYmd, todayYmd) : 0;
              const reminderCount = info?.reminderCount ?? row.reminder_count ?? 0;
              const canRemind = !cooling && stage !== "expired" && stage !== "cancelled";

              return (
                <AppDataTableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/requests/esign/${row.id}`)}
                >
                  <TableCell className="font-mono text-xs">
                    {row.request_code}
                    {/* ui-system §6: the row opens the detail page; the link is the
                        affordance, so the columns stay Figma's rather than growing an
                        extra one for a navigation the whole row already performs. */}
                    <Link
                      href={`/requests/esign/${row.id}`}
                      className="mt-0.5 flex items-center gap-1 font-sans text-[10px] text-primary hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t("viewDetails")}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="max-w-[160px] truncate">{row.driver_name}</div>
                    <div className="text-[11px] text-muted-foreground">{row.driver_code}</div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[300px] truncate text-sm font-medium" title={row.title ?? undefined}>
                      {row.title}
                    </div>
                    <div className="max-w-[300px] truncate text-[11px] text-muted-foreground">
                      {[row.template_name, row.batch_code].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={stage === "opened" ? "info" : "warning"}>
                      {stage === "opened" ? t("stageOpened") : t("stageNotOpened")}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    <div>{row.due_at ? row.due_at.slice(0, 10) : "—"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {ageDays <= 0 ? t("sentToday") : t("sentDaysAgo", { count: ageDays })}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {reminderCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{row.last_reminded_at ? row.last_reminded_at.slice(5, 10) : "—"}</span>
                        <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {reminderCount}×
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t("never")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {canRemind ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 cursor-pointer text-xs font-medium text-primary hover:bg-primary/10"
                          disabled={sendingId === row.id}
                          onClick={() => void remindOne(row)}
                        >
                          {sendingId === row.id ? (
                            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <MailCheck className="me-1.5 h-3.5 w-3.5" />
                          )}
                          {t("remindOne")}
                        </Button>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="inline-flex">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 cursor-not-allowed text-xs font-medium text-muted-foreground"
                                  disabled
                                >
                                  <MailCheck className="me-1.5 h-3.5 w-3.5" />
                                  {t("remindOne")}
                                </Button>
                              </span>
                            }
                          />
                          <TooltipContent>
                            {t("cooldownTooltip", { hours: Math.max(1, Math.ceil(hoursLeft)) })}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                </AppDataTableRow>
              );
            })}
          </AppDataTable>
        )}
      </AppListCard>

      <EsignRemindDialog
        open={remindOpen}
        onOpenChange={setRemindOpen}
        recipients={notOpenedTargets}
        onSent={() => {
          // The query invalidation inside `useRemindEsignRequests` already
          // refreshes every esign key; this only re-runs the list so the
          // "N×" badge in the row the drawer just touched is right.
          void refetch();
        }}
      />
    </AppPage>
  );
}
