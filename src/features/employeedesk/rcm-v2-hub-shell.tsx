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
  INCOMING_TYPE_KEYS,
  rcmAccessChips,
  RCM_ADMIN_CHIPS,
  type IncomingHubFilter,
} from "./rcm-access";
import { useAuth } from "@/contexts/auth-context";
import { LAUNCHER_BRAND } from "@/lib/menu/module-colors";

const NO_BATCHES: EsignBatchRow[] = [];

const OUTGOING_PARENTS = [
  { key: "loan", label: "Loan", glyph: "/hub/out-loan.svg", color: "#7460F1" },
  { key: "payslip", label: "Payslip", glyph: "/hub/out-payslip.svg", color: "#539EFF" },
  { key: "asset", label: "Asset", glyph: "/hub/asset.svg", color: "#4CC57D" },
  { key: "leave", label: "Leave", glyph: "/hub/out-leave.svg", color: "#EF6053" },
  { key: "penalty", label: "Penalty", glyph: "/hub/out-penalty.svg", color: "#E6C45F" },
  { key: "investigation", label: "Investigation", glyph: "/hub/out-investigation.svg", color: "#898989" },
  { key: "accident", label: "Accident", glyph: "/hub/out-accident.svg", color: "#E09B44" },
  { key: "general_doc", label: "General Doc", glyph: "/hub/out-general-doc.svg", color: "#4498D1" },
] as const;

const FALLBACK_PENALTIES = [
  { key: "late_attendance", label: "Late attendance" },
  { key: "unauthorised_absence", label: "Unauthorised absence" },
  { key: "written_warning", label: "Written warning" },
  { key: "damage_to_property", label: "Damage to company property" },
  { key: "penalty_others", label: "Others" },
];

const INCOMING_TYPES: Array<{
  type: (typeof INCOMING_TYPE_KEYS)[number];
  glyph: string;
  glyphSize: number;
  color: string;
  dot: string;
  wrapLabel?: boolean;
}> = [
  { type: "leave", glyph: "/hub/leave.svg", glyphSize: 30, color: "#0F9D8A", dot: "bg-[#0F9D8A]" },
  { type: "asset", glyph: "/hub/asset.svg", glyphSize: 30, color: "#7C3AED", dot: "bg-[#7C3AED]" },
  { type: "fuel", glyph: "/hub/fuel.svg", glyphSize: 30, color: "#EA580C", dot: "bg-[#EA580C]" },
  { type: "fuel_refund", glyph: "/hub/fuel-refund.svg", glyphSize: 40, color: "#EDA23A", dot: "bg-[#EDA23A]" },
  { type: "loan", glyph: "/hub/loan.svg", glyphSize: 30, color: "#2563EB", dot: "bg-[#2563EB]" },
  { type: "complaint", glyph: "/hub/complaint.svg", glyphSize: 30, color: "#DB2777", dot: "bg-[#DB2777]" },
  { type: "document", glyph: "/hub/documents.svg", glyphSize: 30, color: "#4F46E5", dot: "bg-[#4F46E5]" },
  {
    type: "salary_justification",
    glyph: "/hub/salary.svg",
    glyphSize: 30,
    color: "#D25335",
    dot: "bg-[#D25335]",
    wrapLabel: true,
  },
  {
    type: "sick_leave",
    glyph: "/hub/sick.svg",
    glyphSize: 30,
    color: "#D25335",
    dot: "bg-[#D25335]",
    wrapLabel: true,
  },
];

function Glyph({ src, size }: { src: string; size: number }) {
  return <img alt="" src={src} width={size} height={size} className="pointer-events-none" />;
}

function HubTile({
  href,
  glyph,
  glyphSize = 29,
  color,
  label,
  count,
  wrapLabel,
  onClick,
  trailing,
}: {
  href?: string;
  glyph: string;
  glyphSize?: number;
  color: string;
  label: string;
  count?: number;
  wrapLabel?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const body = (
    <>
      <span
        className="grid size-20 place-items-center rounded-[17.455px]"
        style={{ backgroundColor: color }}
      >
        <Glyph src={glyph} size={glyphSize} />
      </span>
      <span
        className={cn(
          "text-center text-sm font-medium leading-normal text-[#18181b]",
          wrapLabel ? "max-w-[100px]" : "whitespace-nowrap",
        )}
      >
        {label}
        {trailing}
      </span>
      {count != null && count > 0 ? (
        <span className="absolute -end-2 -top-[5px] inline-flex items-center justify-center rounded-full border border-[#f6e5c3] bg-[#fffaeb] px-[7px] py-[2px] text-xs font-semibold tabular-nums text-[#b54708]">
          {count > 999 ? "999+" : count}
        </span>
      ) : null}
    </>
  );

  const className =
    "relative flex flex-col items-center gap-2.5 transition-opacity duration-150 hover:opacity-90 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

  if (onClick || !href) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

function FilterChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-xs transition-colors duration-150",
        selected
          ? "bg-[#18181b] font-semibold text-white"
          : "border border-[#e4e4e7] bg-[#f4f4f5] font-medium text-[#71717a] hover:bg-[#ececee]",
      )}
    >
      {children}
    </button>
  );
}

function YouBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-[#fffaeb] px-2 py-[3px] text-xs font-bold text-[#b54708]">
      {children}
    </span>
  );
}

function actionTrack(row: RequestListRow): { done: boolean; percent: number; metric: string } {
  const done = REQUEST_DECIDED_STATUSES.has(row.status);
  const step = row.current_step_order != null && row.current_step_order > 0 ? row.current_step_order : 1;
  const metric = row.current_step_label?.trim() || row.request_code;
  return { done, percent: done ? 100 : Math.min(80, step * 20), metric };
}

function formatSentDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale === "ar" ? "ar" : "en-US", {
    month: "short",
    day: "numeric",
  });
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

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
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
  const [uploadOpen, setUploadOpen] = useState(false);
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [incomingFilter, setIncomingFilter] = useState<IncomingHubFilter>("all");
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
        const live = (categories?.rows ?? []).find(
          (row) => row.is_active && row.key === tile.key,
        );
        return { ...tile, label: live?.label_en || tile.label };
      }),
    [categories?.rows],
  );

  const penaltyChildren = useMemo(() => {
    const live = (categories?.rows ?? []).filter(
      (row) => row.is_active && row.parent_key === "penalty",
    );
    if (live.length > 0) {
      return live.map((row) => ({
        key: row.key,
        label: row.label_en,
      }));
    }
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

  const visibleIncomingTypes = useMemo(
    () =>
      INCOMING_TYPES.filter((tile) =>
        canViewIncomingType(tile.type, grants?.requestTypes ?? [], incomingCtx),
      ),
    [grants, incomingCtx.isSuperAdmin, incomingCtx.hasIncomingView],
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

  const tracker = useMemo(
    () =>
      buildEsignTracker(
        batchesQuery.data?.rows ?? NO_BATCHES,
        recipientsQuery.data?.recipients ?? [],
      ),
    [batchesQuery.data?.rows, recipientsQuery.data?.recipients],
  );

  const recentSends = useMemo(
    () => mergeEsignRecentSends(tracker, singlesQuery.data?.rows ?? [], 5),
    [tracker, singlesQuery.data?.rows],
  );
  const adminChips =
    tab === "incoming"
      ? RCM_ADMIN_CHIPS.filter((chip) => chip.id !== "templates")
      : RCM_ADMIN_CHIPS;
  const sortLabel = sort === "oldest" ? t("oldestFirst") : t("newestFirst");

  return (
    <div
      className="-m-3 flex min-h-svh flex-col [color-scheme:light] bg-[#f9f1eb] text-[#18181b] dark:bg-[#f9f1eb] dark:text-[#18181b]"
      style={{ backgroundColor: LAUNCHER_BRAND.canvas, colorScheme: "light" }}
    >
      <p className="px-6 pt-4 text-sm font-normal text-[#71717a]">{t("hubTitle")}</p>
      <div className="flex items-center justify-between gap-3 border-b border-[#ececee] px-6 py-2.5">
        <div className="inline-flex items-start rounded-lg border-[0.5px] border-black/15 bg-[#f4f4f5] p-[3px]">
          <button
            type="button"
            onClick={() => router.replace("/employeedesk?tab=outgoing")}
            className={cn(
              "flex flex-col items-start gap-[5px] rounded-md px-4 py-1.5 text-start",
              tab === "outgoing" &&
                "border-[0.5px] border-black/10 bg-white shadow-[0_1px_1px_rgba(0,0,0,0.04)]",
            )}
          >
            <span
              className={cn(
                "w-[180px] text-sm",
                tab === "outgoing" ? "font-semibold text-[#18181b]" : "font-normal text-[#71717a]",
              )}
            >
              {t("outgoingShort")}
            </span>
            <span className="text-xs font-normal text-[#787887]">{t("outgoingHint")}</span>
          </button>
          <button
            type="button"
            onClick={() => router.replace("/employeedesk?tab=incoming")}
            className={cn(
              "flex flex-col items-start gap-[5px] rounded-md px-4 py-1.5 text-start",
              tab === "incoming" &&
                "border-[0.5px] border-black/10 bg-white shadow-[0_1px_1px_rgba(0,0,0,0.04)]",
            )}
          >
            <span className="flex w-[180px] items-center justify-between gap-2">
              <span
                className={cn(
                  "text-sm",
                  tab === "incoming" ? "font-semibold text-[#18181b]" : "font-normal text-[#71717a]",
                )}
              >
                {t("incomingShort")}
              </span>
              <span
                className={cn(
                  "rounded-[10px] bg-[#e4e4e7] px-1.5 py-px text-xs font-semibold tabular-nums",
                  tab === "incoming" ? "text-[#18181b]" : "text-[#71717a]",
                )}
              >
                {incomingCount}
              </span>
            </span>
            <span className="text-xs font-normal text-[#787887]">{t("incomingHint")}</span>
          </button>
        </div>
        {senderBadge || receiverBadge ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-normal text-[#71717a]">{t("yourAccess")}</span>
            {senderBadge ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#18181b]",
                  tab === "incoming"
                    ? "border border-[#e4e4e7] bg-[#f4f4f5]"
                    : "bg-[#efeff0]",
                )}
              >
                <span className="grid size-3 place-items-center">
                  <Glyph src="/hub/access-user.svg" size={8} />
                </span>
                {t("access.sender")}
              </span>
            ) : null}
            {receiverBadge ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#18181b]",
                  tab === "incoming"
                    ? "border border-[#e4e4e7] bg-[#f4f4f5]"
                    : "bg-[#efeff0]",
                )}
              >
                <span className="grid size-3 place-items-center">
                  <Glyph src="/hub/access-receiver.svg" size={8} />
                </span>
                {t("access.receiver")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {tab === "outgoing" ? (
        <div className="flex flex-1 flex-col items-start gap-4 px-6 pb-6 pt-2 lg:flex-row">
          <section className="relative z-10 flex w-full shrink-0 flex-col gap-[25px] rounded-xl border border-[#e4e4e7] bg-white p-5 lg:w-[513px] lg:max-w-[710px]">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-[#18181b]">{t("createFromTemplate")}</h2>
                <YouBadge>{t("youSend")}</YouBadge>
              </div>
              <p className="flex flex-wrap items-center gap-1 text-sm leading-normal">
                <span className="font-normal text-[#71717a]">{t("templateHint")}</span>
                <Link
                  href="/employeedesk/esign/templates"
                  className="font-medium text-[#b54708] underline decoration-solid underline-offset-2"
                >
                  {t("seeAllTemplates")}
                </Link>
              </p>
            </div>
            <div className="flex flex-col gap-[30px]">
              {chunk(visibleParents, 4).map((row) => (
                <div key={row[0]?.key} className="flex w-full items-start justify-between gap-2">
                  {row.map((tile) =>
                    tile.key === "penalty" ? (
                      <div key={tile.key} ref={penaltyRef} className="relative">
                        <HubTile
                          glyph={tile.glyph}
                          color={tile.color}
                          label={tile.label}
                          wrapLabel={locale === "ar"}
                          onClick={() => setPenaltyOpen((open) => !open)}
                          trailing={
                            <img
                              alt=""
                              src="/hub/chevron-down.svg"
                              width={14}
                              height={14}
                              className={cn(
                                "ms-[5px] inline-block align-[-2px]",
                                penaltyOpen && "-scale-y-100",
                              )}
                            />
                          }
                        />
                        {penaltyOpen ? (
                          <div className="absolute start-0 top-full z-20 mt-2 flex w-[224px] flex-col gap-2.5 rounded-lg border border-[#e4e4e7] bg-white p-2.5 shadow-[0_4px_6px_rgba(0,0,0,0.08)]">
                            <p className="text-xs font-normal tracking-[0.5px] text-[#a1a1aa] uppercase">
                              {t("penaltyCategory")}
                            </p>
                            <div className="flex flex-col gap-1">
                              {visiblePenaltyChildren.map((child) => (
                                <Link
                                  key={child.key}
                                  href={`/employeedesk/esign/send?category=${alignPenaltyCategoryKey(child.key)}`}
                                  className="flex h-[31px] w-[204px] items-center rounded p-2 text-xs font-normal text-[#18181b] hover:bg-[#f4f4f5]"
                                  onClick={() => setPenaltyOpen(false)}
                                >
                                  {child.label}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <HubTile
                        key={tile.key}
                        href={`/employeedesk/esign/send?category=${tile.key}`}
                        glyph={tile.glyph}
                        color={tile.color}
                        label={tile.label}
                        wrapLabel={locale === "ar"}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </section>

          <div className="flex min-w-0 w-full flex-1 flex-col gap-4">
            <section className="flex flex-col gap-4 rounded-xl border border-[#e4e4e7] bg-white p-5">
              <h2 className="text-base font-semibold text-[#18181b]">{t("sendToMany")}</h2>
              <p className="text-sm font-normal leading-[18px] text-[#71717a]">{t("sendToManyHint")}</p>
              <div className="flex flex-col gap-2">
                <Link
                  href="/employeedesk/esign/bulk"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#18181b] px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#27272a] active:scale-[0.97] motion-reduce:active:scale-100"
                >
                  <Glyph src="/hub/plus.svg" size={14} />
                  {t("importExcel")}
                </Link>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#e4e4e7] bg-white px-4 py-2.5 text-sm font-medium text-[#18181b] transition-colors duration-150 hover:bg-[#fafafa] active:scale-[0.97] motion-reduce:active:scale-100"
                  onClick={() => downloadGenericExampleSheet()}
                >
                  <Glyph src="/hub/download.svg" size={14} />
                  {t("downloadExample")}
                </button>
              </div>
            </section>

            <section className="flex flex-col gap-2 rounded-xl border border-[#e4e4e7] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#18181b]">{t("sentForSignature")}</h2>
                <Link
                  href="/employeedesk/esign/batches"
                  className="text-xs font-medium text-[#b54708] underline decoration-solid underline-offset-2"
                >
                  {t("viewAll")}
                </Link>
              </div>
              {recentSends.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#71717a]">{t("emptySends")}</p>
              ) : (
                <div className="flex flex-col">
                  {recentSends.map((row) => {
                    const done = row.done;
                    const total = row.total;
                    const signed = row.signed;
                    const percent = Math.min(100, row.percent);
                    const sent = formatSentDate(row.created_at, locale);
                    const bulk = row.bulk;
                    return (
                      <div
                        key={`${row.kind}-${row.id}`}
                        className="flex flex-col gap-1 border-b border-[#f4f4f5] py-2 last:border-b-0 last:pb-0"
                      >
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold leading-4 text-[#18181b]">
                              {row.title}
                            </p>
                            <p className="mt-0.5 truncate text-xs leading-4 text-[#71717a]">
                              {bulk
                                ? t("batchEmployeesBulk", { count: total, date: sent })
                                : t("batchEmployees", { count: total, date: sent })}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-medium tabular-nums text-[#3f3f46]">
                            {t("signedOf", { signed, total, percent })}
                          </span>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-semibold",
                              done
                                ? "border-[#d3f3df] bg-[#ecfdf3] text-[#067647]"
                                : "border-[#f6e5c3] bg-[#fffaeb] text-[#b54708]",
                            )}
                          >
                            <span className="size-1 rounded-full bg-current" />
                            {done ? t("completed") : t("inProgress")}
                          </span>
                          <Link
                            href={row.href}
                            className="inline-flex h-7 shrink-0 items-center rounded-md border border-[#e4e4e7] bg-white px-2 text-xs font-medium text-[#18181b] transition-colors duration-150 hover:bg-[#fafafa] active:scale-[0.97] motion-reduce:active:scale-100"
                          >
                            {t("track")}
                          </Link>
                        </div>
                        <div
                          className="h-1 overflow-hidden rounded-full bg-[#e4e4e7]"
                          role="progressbar"
                          aria-valuenow={percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={t("signedOf", { signed, total, percent })}
                        >
                          <div
                            className={cn(
                              "h-full rounded-full motion-reduce:transition-none transition-[width] duration-200 ease-out",
                              done ? "bg-[#067647]" : "bg-[#b54708]",
                            )}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-start gap-4 px-6 pb-6 pt-2 lg:flex-row">
          <section className="flex w-full shrink-0 flex-col gap-[25px] rounded-xl border border-[#e4e4e7] bg-white p-5 lg:w-[431px] lg:max-w-[510px]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#18181b]">{t("queuesWaiting")}</h2>
              <YouBadge>{t("youReceive")}</YouBadge>
            </div>
            <div className="flex flex-col gap-[25px]">
              {chunk(visibleIncomingTypes, 3).map((row) => (
                <div key={row[0]?.type} className="flex w-full items-start justify-between gap-2">
                  {row.map((tile) => (
                    <HubTile
                      key={tile.type}
                      href={`/employeedesk/all?type=${tile.type}&preset=all&scope=all`}
                      glyph={tile.glyph}
                      glyphSize={tile.glyphSize}
                      color={tile.color}
                      wrapLabel={tile.wrapLabel || locale === "ar"}
                      label={t(`types.${tile.type}` as "types.leave")}
                      count={counts[tile.type]?.pending}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-w-0 w-full flex-1 flex-col gap-2 rounded-xl border border-[#e4e4e7] bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#18181b]">{t("needsAction")}</h2>
              <div className="flex items-center gap-1.5">
                <Link
                  href="/employeedesk/all?scope=all"
                  className="text-xs font-medium text-[#b54708] underline decoration-solid underline-offset-2"
                >
                  {t("viewAll")}
                </Link>
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded-md border border-[#e4e4e7] bg-white px-2 text-xs font-medium text-[#18181b] transition-colors duration-150 hover:bg-[#fafafa] active:scale-[0.97] motion-reduce:active:scale-100"
                  onClick={() => setUploadOpen(true)}
                >
                  {t("uploadDocument")}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <FilterChip selected={incomingFilter === "all"} onClick={() => setIncomingFilter("all")}>
                  {t("filterAll", { count: incomingCount })}
                </FilterChip>
                <FilterChip selected={incomingFilter === "due"} onClick={() => setIncomingFilter("due")}>
                  {t("dueToday")}
                </FilterChip>
                <FilterChip
                  selected={incomingFilter === "forwarded"}
                  onClick={() => setIncomingFilter("forwarded")}
                >
                  {t("forwardedToMe")}
                </FilterChip>
              </div>
              <div ref={sortRef} className="relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-normal text-[#71717a]"
                  aria-expanded={sortOpen}
                  onClick={() => setSortOpen((open) => !open)}
                >
                  {sortLabel}
                  <Glyph src="/hub/sort-chevron.svg" size={10} />
                </button>
                {sortOpen ? (
                  <div className="absolute end-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-[#e4e4e7] bg-white p-1 shadow-[0_4px_6px_rgba(0,0,0,0.08)]">
                    {(["oldest", "newest"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={cn(
                          "flex h-[31px] w-full items-center rounded px-2 text-start text-xs text-[#18181b] hover:bg-[#f4f4f5]",
                          sort === value && "bg-[#f4f4f5]",
                        )}
                        onClick={() => {
                          setSort(value);
                          setSortOpen(false);
                        }}
                      >
                        {value === "oldest" ? t("oldestFirst") : t("newestFirst")}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {actionQuery.isPending && actionRows.length === 0 ? (
              <div className="py-6" aria-busy="true" />
            ) : actionRows.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#71717a]">{t("emptyAction")}</p>
            ) : (
              <div className="max-h-[min(22rem,40vh)] min-h-0 overflow-y-auto">
                {actionRows.map((row) => (
                  <ActionRow key={row.id} row={row} locale={locale} />
                ))}
              </div>
            )}
            <p className="text-xs font-normal leading-[15px] text-[#a1a1aa]">{t("incomingFootnote")}</p>
          </section>
        </div>
      )}

      <footer className="mt-auto flex flex-col gap-3 border-t border-[#e4e4e7] bg-white px-6 pt-4 pb-6">
        <p className="text-xs font-semibold tracking-[0.5px] text-[#a1a1aa]">{t("adminOnly")}</p>
        <div className="flex flex-wrap items-start gap-2.5">
          {adminChips.map((chip) => (
            <Link
              key={chip.id}
              href={chip.href}
              className={cn(
                "inline-flex items-center rounded-md border border-[#e4e4e7] bg-white px-3 py-1.5 font-medium text-[#18181b] transition-colors duration-150 hover:bg-[#fafafa]",
                tab === "incoming" ? "text-sm" : "text-xs",
              )}
            >
              {t(`admin.${chip.id}` as "admin.templates")}
            </Link>
          ))}
        </div>
      </footer>
      <IncomingUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

function ActionRow({ row, locale }: { row: RequestListRow; locale: string }) {
  const t = useTranslations("pages.rcmV2");
  const name = maskedListSender(false, row.driver_name, t("confidentialSender"));
  const sent = formatSentDate(row.created_at, locale);
  const who = row.department_label
    ? t("fromEmployeeDept", { name, department: row.department_label })
    : name;
  const track = actionTrack(row);

  return (
    <div className="flex flex-col gap-1 border-b border-[#f4f4f5] py-2 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-4 text-[#18181b]">
            {t(`types.${row.request_type}` as "types.leave")}
          </p>
          {row.is_confidential ? (
            <p className="mt-0.5 inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-[#71717a]">
              <Glyph src="/hub/lock.svg" size={11} />
              <span className="truncate">
                {t("confidentialLine")}
                {track.metric ? ` · ${track.metric}` : ""}
              </span>
            </p>
          ) : (
            <p className="mt-0.5 truncate text-xs leading-4 text-[#71717a]">
              {t("fromPrefix")}
              {who}
              {sent ? ` · ${sent}` : ""}
              {track.metric ? ` · ${track.metric}` : ""}
            </p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-semibold",
            track.done
              ? "border-[#d3f3df] bg-[#ecfdf3] text-[#067647]"
              : "border-[#f6e5c3] bg-[#fffaeb] text-[#b54708]",
          )}
        >
          <span className="size-1 rounded-full bg-current" />
          {track.done ? t("completed") : t("inProgress")}
        </span>
        <Link
          href={`/employeedesk/${row.id}`}
          className="inline-flex h-7 shrink-0 items-center rounded-md border border-[#e4e4e7] bg-white px-2 text-xs font-medium text-[#18181b] transition-colors duration-150 hover:bg-[#fafafa] active:scale-[0.97] motion-reduce:active:scale-100"
        >
          {t("review")}
        </Link>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-[#e4e4e7]"
        role="progressbar"
        aria-valuenow={track.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={track.metric}
      >
        <div
          className={cn(
            "h-full rounded-full motion-reduce:transition-none transition-[width] duration-200 ease-out",
            track.done ? "bg-[#067647]" : "bg-[#b54708]",
          )}
          style={{ width: `${track.percent}%` }}
        />
      </div>
    </div>
  );
}
