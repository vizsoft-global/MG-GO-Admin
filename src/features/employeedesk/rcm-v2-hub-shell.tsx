"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  useEsignBatches,
  useEsignCategories,
  useEsignRequestsList,
  useEsignTrackerRecipients,
  useMyEsignSignatures,
} from "@/features/esign/use-esign";
import { fetchMyDeskGrants, type MyDeskGrants } from "@/features/esign/desk-grants-actions";
import { buildEsignExampleSheet } from "@/features/esign/esign-example-sheet";
import { mergeEsignRecentSends } from "@/features/esign/esign-recent-sends";
import {
  canSendEsignCategory,
  canViewIncomingType,
  hubReceiverBadge,
  hubSenderBadge,
  outgoingCategoryVisible,
} from "@/features/esign/esign-staff-access";
import { buildEsignTracker } from "@/features/esign/esign-tracker";
import { alignPenaltyCategoryKey } from "@/features/esign/outgoing-hub-categories";
import type { EsignBatchRow } from "@/features/esign/types";
import { useAdminRequestsList, useRequestTypeCounts } from "@/features/requests/use-requests";
import { maskedListSender } from "@/features/requests/request-confidential";
import { REQUEST_DECIDED_STATUSES } from "@/features/requests/request-status-utils";
import type { RequestListRow } from "@/features/requests/types";
import { IncomingUploadDialog } from "./incoming-upload-dialog";
import {
  incomingHubListFlags,
  incomingPendingTotal,
  incomingStatusMatch,
  INCOMING_TYPE_KEYS,
  rcmAccessChips,
  RCM_ADMIN_CHIPS,
  type IncomingHubFilter,
} from "./rcm-access";
import { useAuth } from "@/contexts/auth-context";

/**
 * Employee Desk hub — Figma `7267:23667` (BajajCare, "02 / 03 · Employee Desk").
 *
 * The frame is two states of one screen: Outgoing (send for signature) and
 * Incoming (handle what employees send you). Everything visual comes from the
 * frame — warm cream canvas, 24px cards on a `#eee2d8` hairline with a
 * `rgba(122,74,42,0.06)` wash, 64px beige glyph tiles, rust `#a63a24` primary,
 * 13px pills that flip to `#2c2c43` when active.
 *
 * Three things this file states because the shell cannot inherit them:
 *
 *  * **Weights.** `globals.css` maps `--font-weight-medium` / `-semibold` to 400,
 *    so `font-medium` and `font-semibold` would flatten the frame's 500/600 to
 *    regular. Written here as `[font-weight:500]` / `[font-weight:600]`.
 *  * **Radii.** `--radius` is 8px, so `rounded-3xl` is 17.6px and not the
 *    frame's 24px; radii are arbitrary values.
 *  * **Headings.** `p` is pinned to 400 and `h1`–`h3` are re-sized globally, so
 *    headings are `div role="heading"` and bold body copy is `span`.
 *
 * Every behaviour the previous hub had is kept: the tab lives in the URL, the
 * access chips, the penalty sub-menu, the bulk-send sheet, the tracked sends,
 * the incoming queues with their filters and sort, and the upload dialog.
 */
const NO_BATCHES: EsignBatchRow[] = [];

/** The frame's glyph tile, at each size it is drawn. */
const TILE_SIZES = {
  lg: "size-16 rounded-[18px]",
  md: "size-[52px] rounded-[15px]",
  sm: "size-10 rounded-[12px]",
} as const;

const CARD =
  "rounded-[24px] border border-[#eee2d8] bg-white shadow-[0_1px_2px_0px_rgba(0,0,0,0.04),0_10px_30px_0px_rgba(122,74,42,0.06)]";

const OUTGOING_PARENTS = [
  { key: "loan", label: "Loan", glyph: "/hub/v2/out-loan.svg" },
  { key: "payslip", label: "Payslip", glyph: "/hub/v2/out-payslip.svg" },
  { key: "asset", label: "Asset", glyph: "/hub/v2/out-asset.svg" },
  { key: "leave", label: "Leave", glyph: "/hub/v2/out-leave.svg" },
  { key: "penalty", label: "Penalty", glyph: "/hub/v2/out-penalty.svg" },
  { key: "investigation", label: "Investigation", glyph: "/hub/v2/out-investigation.svg" },
  { key: "accident", label: "Accident", glyph: "/hub/v2/out-accident.svg" },
  { key: "general_doc", label: "General Doc", glyph: "/hub/v2/out-general.svg" },
] as const;

const FALLBACK_PENALTIES = [
  { key: "late_attendance", label: "Late attendance" },
  { key: "unauthorised_absence", label: "Unauthorised absence" },
  { key: "written_warning", label: "Written warning" },
  { key: "damage_to_property", label: "Damage to company property" },
  { key: "penalty_others", label: "Others" },
];

/** The frame's muted bar palette for the by-type chart. */
const TYPE_BAR: Record<string, string> = {
  leave: "#8a2f52",
  loan: "#3e4d7a",
  complaint: "#c2462b",
  asset: "#6b4a3a",
  document: "#2f6e7e",
  fuel: "#c08418",
  fuel_refund: "#c08418",
  salary_justification: "#545a6b",
  sick_leave: "#5e7a3a",
};

const INCOMING_TYPES: Array<{ type: (typeof INCOMING_TYPE_KEYS)[number]; glyph: string }> = [
  { type: "leave", glyph: "/hub/v2/type-leave.svg" },
  { type: "loan", glyph: "/hub/v2/type-loan.svg" },
  { type: "complaint", glyph: "/hub/v2/type-complaint.svg" },
  { type: "asset", glyph: "/hub/v2/type-asset.svg" },
  { type: "document", glyph: "/hub/v2/type-general.svg" },
];

type SentFilter = "all" | "in_progress" | "completed";

function Tile({
  glyph,
  size = "lg",
  className,
  children,
}: {
  glyph: string;
  size?: keyof typeof TILE_SIZES;
  className?: string;
  children?: ReactNode;
}) {
  const dims = size === "lg" ? 28 : size === "md" ? 24 : 18;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center border border-[#e9ded5] bg-gradient-to-b from-white to-[#f4ede7] shadow-[0_1px_2px_0px_rgba(0,0,0,0.06),0_6px_14px_0px_rgba(122,74,42,0.1)]",
        TILE_SIZES[size],
        className,
      )}
    >
      <img src={glyph} alt="" width={dims} height={dims} className="relative block" />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_0_white]"
      />
      {children}
    </span>
  );
}

function Pill({
  label,
  active,
  onClick,
  href,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const className = cn(
    "inline-flex items-center rounded-full px-4 py-2 text-[13px] leading-[normal] whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none",
    active
      ? "bg-[#2c2c43] [font-weight:600] text-white"
      : "border border-[#e7dcd2] bg-white [font-weight:500] text-[#4a4553] hover:bg-[#faf4ef]",
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={className}>
      {label}
    </button>
  );
}

function CardHeader({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div
          role="heading"
          aria-level={2}
          className="text-[20px] leading-[normal] [font-weight:700] text-[#262536]"
        >
          {title}
        </div>
        {subtitle ? (
          <span className="text-[14px] leading-[normal] text-[#77707c]">{subtitle}</span>
        ) : null}
      </div>
      {trailing}
    </div>
  );
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-0.5 text-[14px] leading-[normal] [font-weight:600] text-[#a63a24] hover:underline"
    >
      {label}
      <img src="/hub/v2/caret-right-rust.svg" alt="" width={14} height={14} className="block" />
    </Link>
  );
}

function statusTone(status: string): { bg: string; fg: string; dot: string; key: string } {
  if (REQUEST_DECIDED_STATUSES.has(status)) {
    return { bg: "bg-[#e7f5ec]", fg: "text-[#1f8a4c]", dot: "#1f8a4c", key: "completed" };
  }
  switch (status) {
    case "overdue":
      return { bg: "bg-[#fbe7e2]", fg: "text-[#b23a22]", dot: "#b23a22", key: "overdue" };
    case "new":
    case "submitted":
    case "pending":
      return { bg: "bg-[#e9ecf5]", fg: "text-[#3e4d7a]", dot: "#3e4d7a", key: "new" };
    case "in_review":
    case "needs_clarification":
      return { bg: "bg-[#f4e7f1]", fg: "text-[#7a3e6e]", dot: "#7a3e6e", key: "in_review" };
    default:
      return { bg: "bg-[#fcf2de]", fg: "text-[#b7791f]", dot: "#b7791f", key: "in_progress" };
  }
}

function formatSentDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale === "ar" ? "ar" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

function withinDays(iso: string, days: number): boolean {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= days * 86_400_000;
}

function inThisMonth(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
}

function downloadGenericExampleSheet() {
  const sheet = buildEsignExampleSheet([]);
  const blob = new Blob([sheet.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "esign-example-sheet.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RcmV2HubShell() {
  const t = useTranslations("pages.rcmV2");
  const locale = useLocale();
  const { permissions, isSuperAdmin } = useAuth();
  const access = rcmAccessChips(permissions, isSuperAdmin);
  const [grants, setGrants] = useState<MyDeskGrants | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "incoming" ? "incoming" : "outgoing";
  const { data: categories } = useEsignCategories();
  const { data: typeCounts } = useRequestTypeCounts();
  const batchesQuery = useEsignBatches();
  const recipientsQuery = useEsignTrackerRecipients();
  const signaturesQuery = useMyEsignSignatures(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [incomingFilter, setIncomingFilter] = useState<IncomingHubFilter>("all");
  const [sentFilter, setSentFilter] = useState<SentFilter>("all");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const penaltyRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchMyDeskGrants().then((result) => {
      if (!result.error || result.error === "not_configured") setGrants(result);
    });
  }, []);

  useEffect(() => {
    if (!penaltyOpen && !sortOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (penaltyRef.current && !penaltyRef.current.contains(target)) setPenaltyOpen(false);
      if (sortRef.current && !sortRef.current.contains(target)) setSortOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [penaltyOpen, sortOpen]);

  const parents = useMemo(
    () =>
      OUTGOING_PARENTS.map((tile) => {
        const live = (categories?.rows ?? []).find((row) => row.is_active && row.key === tile.key);
        return { ...tile, label: live?.label_en || tile.label };
      }),
    [categories?.rows],
  );

  const penaltyChildren = useMemo(() => {
    const live = (categories?.rows ?? []).filter(
      (row) => row.is_active && row.parent_key === "penalty",
    );
    if (live.length > 0) return live.map((row) => ({ key: row.key, label: row.label_en }));
    return FALLBACK_PENALTIES;
  }, [categories?.rows]);

  const outgoingCtx = grants
    ? { isSuperAdmin: grants.isSuperAdmin, hasOutgoingManage: grants.hasOutgoingManage }
    : { isSuperAdmin, hasOutgoingManage: access.sender };
  const incomingCtx = grants
    ? { isSuperAdmin: grants.isSuperAdmin, hasIncomingView: grants.hasIncomingView }
    : { isSuperAdmin, hasIncomingView: access.receiver };

  const visibleParents = useMemo(
    () =>
      parents.filter((tile) =>
        outgoingCategoryVisible(tile.key, grants?.esignCategories ?? [], outgoingCtx),
      ),
    [parents, grants, outgoingCtx.isSuperAdmin, outgoingCtx.hasOutgoingManage],
  );

  const visiblePenaltyChildren = useMemo(
    () =>
      penaltyChildren.filter((child) =>
        canSendEsignCategory(
          alignPenaltyCategoryKey(child.key),
          grants?.esignCategories ?? [],
          outgoingCtx,
        ),
      ),
    [penaltyChildren, grants, outgoingCtx.isSuperAdmin, outgoingCtx.hasOutgoingManage],
  );

  const senderBadge = grants
    ? hubSenderBadge(grants.esignCategories, outgoingCtx)
    : access.sender;
  const receiverBadge = grants
    ? hubReceiverBadge(grants.requestTypes, incomingCtx)
    : access.receiver;

  const singlesQuery = useEsignRequestsList({ limit: 20 });
  const counts = typeCounts?.counts ?? {};
  const incomingCount = incomingPendingTotal(counts);

  const tracker = useMemo(
    () =>
      buildEsignTracker(
        batchesQuery.data?.rows ?? NO_BATCHES,
        recipientsQuery.data?.recipients ?? [],
      ),
    [batchesQuery.data?.rows, recipientsQuery.data?.recipients],
  );

  // The whole outward history, not just the five the card lists, because the
  // summary strip and the three filters above the list have to agree with it.
  const outwardRows = useMemo(
    () => mergeEsignRecentSends(tracker, singlesQuery.data?.rows ?? [], 200),
    [tracker, singlesQuery.data?.rows],
  );

  const sentSummary = useMemo(() => {
    const week = outwardRows.filter((row) => withinDays(row.created_at, 7));
    const waiting = outwardRows.filter((row) => !row.done);
    const signed = outwardRows.reduce((sum, row) => sum + row.signed, 0);
    const total = outwardRows.reduce((sum, row) => sum + row.total, 0);
    return {
      week: week.length,
      waiting: waiting.length,
      percent: total > 0 ? Math.round((signed / total) * 100) : null,
      inProgress: waiting.length,
      completed: outwardRows.length - waiting.length,
    };
  }, [outwardRows]);

  const sentRows = useMemo(() => {
    const filtered = outwardRows.filter((row) =>
      sentFilter === "completed" ? row.done : sentFilter === "in_progress" ? !row.done : true,
    );
    return filtered.slice(0, 5);
  }, [outwardRows, sentFilter]);

  const flags = incomingHubListFlags(incomingFilter);
  const actionQuery = useAdminRequestsList({
    datePreset: "all",
    limit: 50,
    sort: sort === "oldest" ? "oldest" : undefined,
    assignedToMe: flags.assignedToMe,
    forwardedToMe: flags.forwardedToMe,
    dueToday: flags.dueToday,
  });

  const actionRows = useMemo(() => {
    const rows = [...(actionQuery.data?.rows ?? [])].filter((row) => {
      if (!canViewIncomingType(row.request_type, grants?.requestTypes ?? [], incomingCtx)) {
        return false;
      }
      if (incomingFilter === "all" && REQUEST_DECIDED_STATUSES.has(row.status)) return false;
      if (!incomingStatusMatch(row.status, incomingFilter)) return false;
      return true;
    });
    rows.sort((a, b) => {
      const delta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sort === "oldest" ? delta : -delta;
    });
    return rows;
  }, [
    actionQuery.data?.rows,
    sort,
    incomingFilter,
    grants,
    incomingCtx.isSuperAdmin,
    incomingCtx.hasIncomingView,
  ]);

  const incomingStats = useMemo(() => {
    const inProgress = actionRows.filter(
      (row) => row.status === "in_review" || row.status === "needs_clarification",
    ).length;
    return {
      review: incomingCount,
      inProgress,
      signature: signaturesQuery.data?.rows?.length ?? 0,
      closed: outwardRows.filter((row) => row.done && inThisMonth(row.created_at)).length,
    };
  }, [actionRows, incomingCount, signaturesQuery.data, outwardRows]);

  const typeBreakdown = useMemo(() => {
    const rows = INCOMING_TYPES.map((entry) => ({
      ...entry,
      count: Number(counts[entry.type]?.pending ?? 0),
    })).filter((row) => row.count > 0);
    const max = rows.reduce((peak, row) => Math.max(peak, row.count), 0);
    return { rows, max };
  }, [counts]);

  // The API reports average *resolution* time (`RequestKpis.avg_resolution_seconds`),
  // not a first-response timestamp, so the card is labelled for what it measures
  // and the trend comes from the preceding window the same call returns.
  const responseKpi = actionQuery.data?.kpi;
  const responseLabel = useMemo(() => {
    const seconds = responseKpi?.avg_resolution_seconds ?? null;
    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }, [responseKpi?.avg_resolution_seconds]);
  const responseTrend = useMemo(() => {
    const now = responseKpi?.avg_resolution_seconds ?? null;
    const prev = responseKpi?.prev_avg_resolution_seconds ?? null;
    if (now == null || prev == null || !Number.isFinite(now) || !Number.isFinite(prev) || prev <= 0) {
      return null;
    }
    const delta = Math.round(((prev - now) / prev) * 100);
    return delta === 0 ? null : delta;
  }, [responseKpi?.avg_resolution_seconds, responseKpi?.prev_avg_resolution_seconds]);

  const adminChips =
    tab === "incoming"
      ? RCM_ADMIN_CHIPS.filter((chip) => chip.id !== "templates")
      : RCM_ADMIN_CHIPS;

  const sortLabel = sort === "oldest" ? t("oldestFirst") : t("newestFirst");

  return (
    <div className="-m-3 flex min-h-svh flex-col [color-scheme:light] bg-[#faf3ee] text-[#262536]">
      {/* Header — frame padding 28 / 40, then a 24 gap before the tab strip. */}
      <div className="flex w-full flex-col gap-6 px-6 pt-7 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-[14px]">
            <nav aria-label={t("breadcrumbHome")} className="flex items-center gap-1.5">
              <img src="/hub/v2/home.svg" alt="" width={14} height={14} className="block" />
              <Link
                href="/dashboard"
                className="text-[13px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#77707c] hover:text-[#262536]"
              >
                {t("breadcrumbHome")}
              </Link>
              <img src="/hub/v2/caret-right.svg" alt="" width={14} height={14} className="block" />
              <span className="text-[13px] leading-[normal] [font-weight:600] whitespace-nowrap text-[#262536]">
                {t("hubTitle")}
              </span>
            </nav>

            <div className="flex items-center gap-4">
              <Tile glyph="/hub/v2/title-desk.svg" />
              <div className="flex flex-col gap-1">
                <div
                  role="heading"
                  aria-level={1}
                  className="text-[30px] leading-[normal] [font-weight:700] whitespace-nowrap text-[#262536]"
                >
                  {t("hubTitle")}
                </div>
                <span className="text-[14px] leading-[normal] text-[#77707c]">
                  {t("hubSubtitle")}
                </span>
              </div>
            </div>
          </div>

          {senderBadge || receiverBadge ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#77707c]">
                {t("yourAccess")}
              </span>
              {senderBadge ? (
                <span className="inline-flex items-center rounded-full border border-[#e7dcd2] bg-white px-4 py-2 text-[13px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#4a4553]">
                  {t("access.sender")}
                </span>
              ) : null}
              {receiverBadge ? (
                <span className="inline-flex items-center rounded-full border border-[#e7dcd2] bg-white px-4 py-2 text-[13px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#4a4553]">
                  {t("access.receiver")}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="inline-flex w-fit gap-1 rounded-[16px] bg-[#f0e4da] p-1">
          <button
            type="button"
            onClick={() => router.replace("/employeedesk?tab=outgoing")}
            aria-current={tab === "outgoing" ? "page" : undefined}
            className={cn(
              "flex w-[260px] flex-col gap-0.5 rounded-[12px] px-[18px] py-3 text-start transition-colors duration-150 motion-reduce:transition-none",
              tab === "outgoing" &&
                "bg-white shadow-[0_0_1px_0_rgba(0,0,0,0.04),0_2px_6px_0_rgba(122,74,42,0.08)]",
            )}
          >
            <span
              className={cn(
                "text-[15px] leading-[normal]",
                tab === "outgoing"
                  ? "[font-weight:700] text-[#262536]"
                  : "[font-weight:600] text-[#5e5763]",
              )}
            >
              {t("outgoingShort")}
            </span>
            <span className="text-[12px] leading-[normal] text-[#77707c]">{t("outgoingHint")}</span>
          </button>
          <button
            type="button"
            onClick={() => router.replace("/employeedesk?tab=incoming")}
            aria-current={tab === "incoming" ? "page" : undefined}
            className={cn(
              "flex w-[260px] flex-col gap-0.5 rounded-[12px] px-[18px] py-3 text-start transition-colors duration-150 motion-reduce:transition-none",
              tab === "incoming" &&
                "bg-white shadow-[0_0_1px_0_rgba(0,0,0,0.04),0_2px_6px_0_rgba(122,74,42,0.08)]",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "text-[15px] leading-[normal]",
                  tab === "incoming"
                    ? "[font-weight:700] text-[#262536]"
                    : "[font-weight:600] text-[#5e5763]",
                )}
              >
                {t("incomingShort")}
              </span>
              {incomingCount > 0 ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#d9472b] px-[7px] py-0.5 drop-shadow-[0_2px_2px_rgba(217,71,43,0.25)]">
                  <span className="text-[11px] leading-[normal] [font-weight:700] text-white tabular-nums">
                    {incomingCount > 99 ? "99+" : incomingCount}
                  </span>
                </span>
              ) : null}
            </span>
            <span className="text-[12px] leading-[normal] text-[#77707c]">{t("incomingHint")}</span>
          </button>
        </div>
      </div>

      {/* Body — 24px above the panels, 32px below, 40px each side. */}
      <div className="flex w-full flex-col gap-6 px-6 pb-8 pt-6 lg:px-10">
        {tab === "outgoing" ? (
          <div className="flex w-full flex-col gap-6">
            <div className="flex flex-col items-start gap-6 lg:flex-row">
              <div className="flex w-full shrink-0 flex-col gap-6 lg:w-[600px]">
                <section className={cn(CARD, "flex flex-col gap-6 p-7")}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div
                        role="heading"
                        aria-level={2}
                        className="text-[20px] leading-[normal] [font-weight:700] text-[#262536]"
                      >
                        {t("createFromTemplate")}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[14px] leading-[normal] text-[#77707c]">
                          {t("templateHint")}
                        </span>
                        <SeeAll href="/employeedesk/esign/templates" label={t("seeAllShort")} />
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-lg bg-[#fbe9e1] px-2.5 py-[5px]">
                      <span className="text-[11px] leading-[normal] [font-weight:700] tracking-[0.8px] whitespace-nowrap text-[#a63a24]">
                        {t("youSend")}
                      </span>
                    </span>
                  </div>

                  <div className="flex w-full flex-wrap items-start justify-between gap-y-[26px]">
                    {visibleParents.map((tile) =>
                      tile.key === "penalty" ? (
                        <div
                          key={tile.key}
                          ref={penaltyRef}
                          className="relative flex w-32 shrink-0 flex-col items-center gap-2.5"
                        >
                          <button
                            type="button"
                            onClick={() => setPenaltyOpen((open) => !open)}
                            aria-expanded={penaltyOpen}
                            className="flex flex-col items-center gap-2.5 outline-none focus-visible:rounded-[18px] focus-visible:ring-2 focus-visible:ring-[#a63a24]/40"
                          >
                            <Tile glyph={tile.glyph} />
                            <span className="flex flex-col items-center gap-0.5">
                              <span className="text-[14px] leading-[normal] [font-weight:600] whitespace-nowrap text-[#262536]">
                                {tile.label}
                              </span>
                              <span className="text-[12px] leading-[normal] whitespace-nowrap text-[#77707c]">
                                {t("penaltyTypeCount", { count: visiblePenaltyChildren.length })}
                              </span>
                            </span>
                          </button>
                          {penaltyOpen ? (
                            <div className="absolute start-0 top-full z-20 mt-2 flex w-56 flex-col gap-2.5 rounded-xl border border-[#eee2d8] bg-white p-2.5 shadow-[0_10px_30px_0_rgba(122,74,42,0.14)]">
                              <span className="text-[11px] [font-weight:600] tracking-[0.5px] uppercase text-[#a1a1aa]">
                                {t("penaltyCategory")}
                              </span>
                              <div className="flex flex-col gap-0.5">
                                {visiblePenaltyChildren.map((child) => (
                                  <Link
                                    key={child.key}
                                    href={`/employeedesk/esign/send?category=${alignPenaltyCategoryKey(child.key)}`}
                                    onClick={() => setPenaltyOpen(false)}
                                    className="flex h-8 w-full items-center rounded px-2 text-[12px] leading-[normal] text-[#262536] hover:bg-[#faf4ef]"
                                  >
                                    {child.label}
                                  </Link>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <Link
                          key={tile.key}
                          href={`/employeedesk/esign/send?category=${tile.key}`}
                          className="flex w-32 shrink-0 flex-col items-center gap-2.5 outline-none focus-visible:rounded-[18px] focus-visible:ring-2 focus-visible:ring-[#a63a24]/40"
                        >
                          <Tile glyph={tile.glyph} />
                          <span className="text-[14px] leading-[normal] [font-weight:600] text-center text-[#262536]">
                            {tile.label}
                          </span>
                        </Link>
                      ),
                    )}
                  </div>
                </section>

                <section className={cn(CARD, "flex flex-col gap-5 p-7")}>
                  <div className="flex items-start gap-4">
                    <Tile glyph="/hub/v2/bulk.svg" size="md" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div
                        role="heading"
                        aria-level={2}
                        className="text-[18px] leading-[normal] [font-weight:700] text-[#262536]"
                      >
                        {t("sendToMany")}
                      </div>
                      <span className="text-[14px] leading-[normal] text-[#77707c]">
                        {t("sendToManyHint")}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="/employeedesk/esign/bulk"
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#a63a24] py-[11px] ps-[18px] pe-5 text-[14px] leading-[normal] [font-weight:600] whitespace-nowrap text-white drop-shadow-[0_4px_5px_rgba(166,58,36,0.25)] transition-colors duration-150 hover:bg-[#8f331f] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
                    >
                      <img src="/hub/v2/plus.svg" alt="" width={18} height={18} className="block" />
                      {t("importExcel")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => downloadGenericExampleSheet()}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#e2d6cc] bg-white py-[11px] ps-[18px] pe-5 text-[14px] leading-[normal] [font-weight:600] whitespace-nowrap text-[#2c2c43] drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)] transition-colors duration-150 hover:bg-[#faf4ef] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
                    >
                      <img src="/hub/v2/download.svg" alt="" width={18} height={18} className="block" />
                      {t("downloadExample")}
                    </button>
                  </div>
                </section>
              </div>

              <section className={cn(CARD, "flex min-w-0 flex-1 flex-col gap-[18px] p-7")}>
                <CardHeader
                  title={t("sentForSignature")}
                  subtitle={t("sentForSignatureHint")}
                  trailing={<SeeAll href="/employeedesk/esign/batches" label={t("viewAll")} />}
                />

                <div className="flex w-full items-center rounded-2xl bg-[#faf4ef] px-5 py-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[24px] leading-[normal] [font-weight:700] text-[#262536] tabular-nums">
                      {sentSummary.week}
                    </span>
                    <span className="text-[12px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#77707c]">
                      {t("sentThisWeek")}
                    </span>
                  </div>
                  <span aria-hidden className="h-9 w-px shrink-0 bg-[#e9ddd3]" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 ps-5">
                    <span className="text-[24px] leading-[normal] [font-weight:700] text-[#262536] tabular-nums">
                      {sentSummary.waiting}
                    </span>
                    <span className="text-[12px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#77707c]">
                      {t("waitingForSignature")}
                    </span>
                  </div>
                  <span aria-hidden className="h-9 w-px shrink-0 bg-[#e9ddd3]" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 ps-5">
                    <span className="text-[24px] leading-[normal] [font-weight:700] text-[#1f8a4c] tabular-nums">
                      {sentSummary.percent == null ? "—" : `${sentSummary.percent}%`}
                    </span>
                    <span className="text-[12px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#77707c]">
                      {t("completionRate")}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Pill
                    label={t("filterAll", { count: outwardRows.length })}
                    active={sentFilter === "all"}
                    onClick={() => setSentFilter("all")}
                  />
                  <Pill
                    label={t("filterCount", {
                      label: t("inProgress"),
                      count: sentSummary.inProgress,
                    })}
                    active={sentFilter === "in_progress"}
                    onClick={() => setSentFilter("in_progress")}
                  />
                  <Pill
                    label={t("filterCount", {
                      label: t("completed"),
                      count: sentSummary.completed,
                    })}
                    active={sentFilter === "completed"}
                    onClick={() => setSentFilter("completed")}
                  />
                </div>

                {sentRows.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-[#77707c]">{t("emptySends")}</p>
                ) : (
                  <div className="flex w-full flex-col">
                    {sentRows.map((row) => (
                      <div
                        key={`${row.kind}-${row.id}`}
                        className="flex w-full items-center gap-3.5 border-b border-[#f0e6de] py-3.5 last:border-b-0 last:pb-0"
                      >
                        <Tile
                          glyph={row.bulk ? "/hub/v2/doc-small.svg" : "/hub/v2/loan-small.svg"}
                          size="sm"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[15px] leading-[normal] [font-weight:600] text-[#262536]">
                            {row.title}
                          </span>
                          <span className="truncate text-[13px] leading-[normal] text-[#77707c]">
                            {row.bulk
                              ? t("batchEmployeesBulk", {
                                  count: row.total,
                                  date: formatSentDate(row.created_at, locale),
                                })
                              : t("batchEmployees", {
                                  count: row.total,
                                  date: formatSentDate(row.created_at, locale),
                                })}
                          </span>
                        </div>
                        <span className="shrink-0 text-[12px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#3f3f46] tabular-nums">
                          {t("signedOf", {
                            signed: row.signed,
                            total: row.total,
                            percent: Math.min(100, row.percent),
                          })}
                        </span>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-[5px]",
                            row.done ? "bg-[#e7f5ec]" : "bg-[#fcf2de]",
                          )}
                        >
                          <span
                            aria-hidden
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: row.done ? "#1f8a4c" : "#b7791f" }}
                          />
                          <span
                            className={cn(
                              "text-[12px] leading-[normal] [font-weight:600] whitespace-nowrap",
                              row.done ? "text-[#1f8a4c]" : "text-[#b7791f]",
                            )}
                          >
                            {row.done ? t("completed") : t("inProgress")}
                          </span>
                        </span>
                        <Link
                          href={row.href}
                          className="inline-flex h-8 shrink-0 items-center rounded-lg border border-[#e7dcd2] bg-white px-3 text-[12px] leading-[normal] [font-weight:600] text-[#2c2c43] transition-colors duration-150 hover:bg-[#faf4ef] motion-reduce:transition-none"
                        >
                          {t("track")}
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <AdminToolsCard chips={adminChips} label={(id) => t(`admin.${id}` as "admin.templates")} />
          </div>
        ) : (
          <div className="flex w-full flex-col gap-6">
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                glyph="/hub/v2/stat-review.svg"
                value={incomingStats.review}
                label={t("statToReview")}
                tone="rust"
                emphasised
              />
              <StatCard
                glyph="/hub/v2/stat-progress.svg"
                value={incomingStats.inProgress}
                label={t("statInProgress")}
              />
              <StatCard
                glyph="/hub/v2/stat-signature.svg"
                value={incomingStats.signature}
                label={t("statWaitingSignature")}
              />
              <StatCard
                glyph="/hub/v2/stat-closed.svg"
                value={incomingStats.closed}
                label={t("statClosedThisMonth")}
              />
            </div>

            <div className="flex flex-col items-start gap-6 lg:flex-row">
              <section className={cn(CARD, "flex min-w-0 flex-1 flex-col gap-[18px] p-7")}>
                <div className="flex w-full flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div
                      role="heading"
                      aria-level={2}
                      className="text-[20px] leading-[normal] [font-weight:700] whitespace-nowrap text-[#262536]"
                    >
                      {t("requestsToHandle")}
                    </div>
                    <span className="text-[14px] leading-[normal] text-[#77707c]">
                      {t("requestsToHandleHint")}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-10 w-[280px] items-center gap-2 rounded-xl border border-[#eadfd5] bg-[#faf4ef] px-[14px]">
                      <img src="/hub/v2/search.svg" alt="" width={16} height={16} className="block" />
                      <span className="truncate text-[13px] leading-[normal] text-[#77707c]/90">
                        {t("searchPlaceholder")}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setUploadOpen(true)}
                      className="inline-flex h-10 items-center rounded-xl border border-[#e2d6cc] bg-white px-3 text-[13px] leading-[normal] [font-weight:600] whitespace-nowrap text-[#2c2c43] transition-colors duration-150 hover:bg-[#faf4ef] motion-reduce:transition-none"
                    >
                      {t("uploadDocument")}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Pill
                    label={t("filterAll", { count: incomingCount })}
                    active={incomingFilter === "all"}
                    onClick={() => setIncomingFilter("all")}
                  />
                  <Pill
                    label={t("filterCount", {
                      label: t("statusNew"),
                      count: actionRows.filter((row) => row.status === "submitted" || row.status === "pending").length,
                    })}
                    active={incomingFilter === "new"}
                    onClick={() => setIncomingFilter("new")}
                  />
                  <Pill
                    label={t("filterCount", {
                      label: t("statusInReview"),
                      count: actionRows.filter((row) => row.status === "in_review").length,
                    })}
                    active={incomingFilter === "in_review"}
                    onClick={() => setIncomingFilter("in_review")}
                  />
                  <Pill
                    label={t("filterCount", {
                      label: t("inProgress"),
                      count: actionRows.filter((row) => row.status === "needs_clarification").length,
                    })}
                    active={incomingFilter === "clarification"}
                    onClick={() => setIncomingFilter("clarification")}
                  />
                  <Pill
                    label={t("filterCount", {
                      label: t("statusOverdue"),
                      count: actionRows.filter((row) => row.status === "overdue").length,
                    })}
                    active={incomingFilter === "due"}
                    onClick={() => setIncomingFilter("due")}
                  />
                </div>

                <div className="flex w-full flex-col">
                  <div className="flex w-full items-start gap-4 rounded-[10px] bg-[#faf4ef] px-3.5 py-2.5">
                    <span className="w-[280px] shrink-0 text-[11px] leading-[normal] [font-weight:700] tracking-[0.8px] whitespace-nowrap text-[#77707c]">
                      {t("colEmployee")}
                    </span>
                    <span className="w-[200px] shrink-0 text-[11px] leading-[normal] [font-weight:700] tracking-[0.8px] whitespace-nowrap text-[#77707c]">
                      {t("colRequest")}
                    </span>
                    <span className="hidden w-[120px] shrink-0 text-[11px] leading-[normal] [font-weight:700] tracking-[0.8px] whitespace-nowrap text-[#77707c] lg:block">
                      {t("colReceived")}
                    </span>
                    <span className="w-[140px] shrink-0 text-[11px] leading-[normal] [font-weight:700] tracking-[0.8px] whitespace-nowrap text-[#77707c]">
                      {t("colStatus")}
                    </span>
                    <span className="flex-1" />
                  </div>
                  {actionQuery.isPending && actionRows.length === 0 ? (
                    <div className="py-10" aria-busy="true" />
                  ) : actionRows.length === 0 ? (
                    <p className="py-10 text-center text-[13px] text-[#77707c]">{t("emptyAction")}</p>
                  ) : (
                    <div className="max-h-[min(26rem,46vh)] overflow-y-auto">
                      {actionRows.slice(0, 6).map((row) => (
                        <RequestRow
                          key={row.id}
                          row={row}
                          locale={locale}
                          labels={{
                            confidential: t("confidentialSender"),
                            fromPrefix: t("fromPrefix"),
                            review: t("review"),
                          }}
                          typeLabel={t(`types.${row.request_type}` as "types.leave")}
                          statusLabels={{
                            completed: t("completed"),
                            overdue: t("statusOverdue"),
                            new: t("statusNew"),
                            in_review: t("statusInReview"),
                            in_progress: t("inProgress"),
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                  <span className="text-[13px] leading-[normal] text-[#77707c]">
                    {actionRows.length > 6
                      ? t("showingOf", { shown: 6, total: actionRows.length })
                      : t("showingAll", { total: actionRows.length })}
                  </span>
                  <div className="flex items-center gap-3">
                    <div ref={sortRef} className="relative">
                      <button
                        type="button"
                        aria-expanded={sortOpen}
                        onClick={() => setSortOpen((open) => !open)}
                        className="inline-flex items-center gap-1 text-[13px] leading-[normal] text-[#77707c] hover:text-[#262536]"
                      >
                        {sortLabel}
                        <img
                          src="/hub/sort-chevron.svg"
                          alt=""
                          width={10}
                          height={10}
                          className={cn("block", sortOpen && "-scale-y-100")}
                        />
                      </button>
                      {sortOpen ? (
                        <div className="absolute end-0 top-full z-20 mt-1 min-w-[140px] rounded-xl border border-[#eee2d8] bg-white p-1 shadow-[0_10px_30px_0_rgba(122,74,42,0.14)]">
                          {(["oldest", "newest"] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => {
                                setSort(value);
                                setSortOpen(false);
                              }}
                              className={cn(
                                "flex h-8 w-full items-center rounded px-2 text-start text-[12px] text-[#262536] hover:bg-[#faf4ef]",
                                sort === value && "bg-[#faf4ef]",
                              )}
                            >
                              {value === "oldest" ? t("oldestFirst") : t("newestFirst")}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <SeeAll href="/employeedesk/all?scope=all" label={t("viewAllRequests")} />
                  </div>
                </div>
              </section>

              <div className="flex w-full shrink-0 flex-col gap-6 lg:w-[340px]">
                <section className={cn(CARD, "flex flex-col gap-4 p-6")}>
                  <div
                    role="heading"
                    aria-level={2}
                    className="text-[18px] leading-[normal] [font-weight:700] whitespace-nowrap text-[#262536]"
                  >
                    {t("byRequestType")}
                  </div>
                  {typeBreakdown.rows.length === 0 ? (
                    <p className="py-4 text-[13px] text-[#77707c]">{t("emptyAction")}</p>
                  ) : (
                    typeBreakdown.rows.map((row) => (
                      <div key={row.type} className="flex flex-col gap-2">
                        <div className="flex w-full items-center gap-3">
                          <Tile glyph={row.glyph} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-[14px] leading-[normal] [font-weight:600] text-[#262536]">
                            {t(`types.${row.type}` as "types.leave")}
                          </span>
                          <span className="shrink-0 text-[15px] leading-[normal] [font-weight:700] text-[#262536] tabular-nums">
                            {row.count}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f3ebe4]">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${typeBreakdown.max > 0 ? Math.round((row.count / typeBreakdown.max) * 100) : 0}%`,
                              backgroundColor: TYPE_BAR[row.type] ?? "#545a6b",
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </section>

                <section className={cn(CARD, "flex flex-col gap-2.5 p-6")}>
                  <div className="flex items-center gap-3">
                    <Tile glyph="/hub/v2/type-general.svg" size="sm" />
                    <span className="text-[14px] leading-[normal] [font-weight:600] whitespace-nowrap text-[#262536]">
                      {t("avgResolution")}
                    </span>
                  </div>
                  <span className="text-[30px] leading-[normal] [font-weight:700] whitespace-nowrap text-[#262536]">
                    {responseLabel ?? "—"}
                  </span>
                  {responseTrend != null ? (
                    <span
                      className={cn(
                        "inline-flex w-fit items-center rounded-full px-2.5 py-1",
                        responseTrend > 0 ? "bg-[#e7f5ec]" : "bg-[#fbe7e2]",
                      )}
                    >
                      <span
                        className={cn(
                          "text-[12px] leading-[normal] [font-weight:600] whitespace-nowrap",
                          responseTrend > 0 ? "text-[#1f8a4c]" : "text-[#b23a22]",
                        )}
                      >
                        {t("trendVsLastWeek", { percent: Math.abs(responseTrend) })}
                      </span>
                    </span>
                  ) : null}
                </section>
              </div>
            </div>

            <AdminToolsCard chips={adminChips} label={(id) => t(`admin.${id}` as "admin.templates")} />
          </div>
        )}
      </div>

      <IncomingUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

function StatCard({
  glyph,
  value,
  label,
  emphasised,
  tone,
}: {
  glyph: string;
  value: number;
  label: string;
  emphasised?: boolean;
  tone?: "rust";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3.5 rounded-[24px] border bg-white p-5",
        emphasised ? "border-[#ebc9bc]" : "border-[#eee2d8]",
        "shadow-[0_1px_2px_0px_rgba(0,0,0,0.04),0_10px_30px_0px_rgba(122,74,42,0.06)]",
      )}
    >
      <Tile glyph={glyph} size="md" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "text-[26px] leading-[normal] [font-weight:700] tabular-nums",
            tone === "rust" ? "text-[#a63a24]" : "text-[#262536]",
          )}
        >
          {value}
        </span>
        <span className="text-[13px] leading-[normal] [font-weight:500] text-[#77707c]">{label}</span>
      </div>
    </div>
  );
}

function AdminToolsCard({
  chips,
  label,
}: {
  chips: readonly { id: string; href: string }[];
  label: (id: string) => string;
}) {
  const t = useTranslations("pages.rcmV2");
  const GLYPH: Record<string, string> = {
    templates: "/hub/v2/tool-templates.svg",
    toSign: "/hub/v2/tool-tosign.svg",
    all: "/hub/v2/tool-requests.svg",
    reports: "/hub/v2/tool-reports.svg",
    audit: "/hub/v2/tool-audit.svg",
    settings: "/hub/v2/tool-settings.svg",
    visits: "/hub/v2/tool-meetings.svg",
  };
  return (
    <section className={cn(CARD, "flex flex-col gap-[22px] p-7")}>
      <div className="flex w-full flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div
            role="heading"
            aria-level={2}
            className="text-[18px] leading-[normal] [font-weight:700] whitespace-nowrap text-[#262536]"
          >
            {t("adminTools")}
          </div>
          <span className="text-[14px] leading-[normal] text-[#77707c]">{t("adminToolsHint")}</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f3e9e1] px-3 py-1.5">
          <img src="/hub/v2/shield.svg" alt="" width={14} height={14} className="block" />
          <span className="text-[12px] leading-[normal] [font-weight:600] whitespace-nowrap text-[#4a4553]">
            {t("adminsOnly")}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        {chips.map((chip) => (
          <Link
            key={chip.id}
            href={chip.href}
            className="flex w-[150px] flex-col items-center gap-2.5 outline-none focus-visible:rounded-[15px] focus-visible:ring-2 focus-visible:ring-[#a63a24]/40"
          >
            <Tile glyph={GLYPH[chip.id] ?? "/hub/v2/tool-settings.svg"} size="md" />
            <span className="w-[150px] text-center text-[13px] leading-[normal] [font-weight:600] text-[#262536]">
              {label(chip.id)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function RequestRow({
  row,
  locale,
  labels,
  typeLabel,
  statusLabels,
}: {
  row: RequestListRow;
  locale: string;
  labels: { confidential: string; fromPrefix: string; review: string };
  typeLabel: string;
  statusLabels: Record<string, string>;
}) {
  const name = maskedListSender(false, row.driver_name, labels.confidential);
  const received = formatSentDate(row.created_at, locale);
  const tone = statusTone(row.status);
  const role = row.department_label ?? "";
  const subtitle = row.is_confidential
    ? labels.confidential
    : [role, row.employee_id ? `EMP-${row.employee_id}` : row.driver_code]
        .filter(Boolean)
        .join(" · ");
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex w-full items-center gap-4 border-b border-[#f0e6de] p-3.5 last:border-b-0">
      <div className="flex w-[280px] shrink-0 items-center gap-3">
        <span className="grid size-[38px] shrink-0 place-items-center rounded-[19px] bg-[#e8ebf3]">
          <span className="text-[13px] leading-[normal] [font-weight:700] text-[#3e4d7a]">
            {initials || "—"}
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[14px] leading-[normal] [font-weight:600] text-[#262536]">
            {name}
          </span>
          <span className="truncate text-[12px] leading-[normal] text-[#77707c]">{subtitle}</span>
        </div>
      </div>
      <div className="flex w-[200px] shrink-0 items-center gap-2">
        <span className="truncate text-[13px] leading-[normal] text-[#262536]">{typeLabel}</span>
      </div>
      <span className="hidden w-[120px] shrink-0 truncate text-[13px] leading-[normal] text-[#77707c] lg:block">
        {received || "—"}
      </span>
      <div className="w-[140px] shrink-0">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-[5px]",
            tone.bg,
          )}
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: tone.dot }}
          />
          <span className={cn("text-[12px] leading-[normal] [font-weight:600] whitespace-nowrap", tone.fg)}>
            {statusLabels[tone.key] ?? tone.key}
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 justify-end">
        <Link
          href={`/employeedesk/${row.id}`}
          className="inline-flex h-8 shrink-0 items-center rounded-lg bg-[#a63a24] px-3.5 text-[12px] leading-[normal] [font-weight:600] whitespace-nowrap text-white transition-colors duration-150 hover:bg-[#8f331f] motion-reduce:transition-none"
        >
          {labels.review}
        </Link>
      </div>
    </div>
  );
}
