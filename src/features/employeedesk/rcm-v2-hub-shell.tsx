"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Cross,
  FileText,
  Folder,
  Fuel,
  Inbox,
  LayoutDashboard,
  Package,
  Plus,
  Search,
  Send,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  useEsignBatches,
  useEsignCategories,
  useEsignTrackerRecipients,
} from "@/features/esign/use-esign";
import { buildEsignExampleSheet } from "@/features/esign/esign-example-sheet";
import { buildEsignTracker } from "@/features/esign/esign-tracker";
import type { EsignBatchRow } from "@/features/esign/types";
import { useAdminRequestsList, useRequestTypeCounts } from "@/features/requests/use-requests";
import { maskedListSender } from "@/features/requests/request-confidential";
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

const NO_BATCHES: EsignBatchRow[] = [];

const OUTGOING_PARENTS: Array<{
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
}> = [
  { key: "loan", label: "Loan", icon: CircleDollarSign, color: "bg-[#7C6CF6]" },
  { key: "payslip", label: "Payslip", icon: FileText, color: "bg-[#A78BFA]" },
  { key: "asset", label: "Asset", icon: Package, color: "bg-[#2DD4BF]" },
  { key: "leave", label: "Leave", icon: CalendarDays, color: "bg-[#FB923C]" },
  { key: "penalty", label: "Penalty", icon: Shield, color: "bg-[#8B5CF6]" },
  { key: "investigation", label: "Investigation", icon: Search, color: "bg-[#FBBF24]" },
  { key: "accident", label: "Accident", icon: Cross, color: "bg-[#F97316]" },
  { key: "general_doc", label: "General Doc", icon: FileText, color: "bg-[#60A5FA]" },
];

const FALLBACK_PENALTIES = [
  { key: "late_attendance", label: "Late attendance" },
  { key: "unauthorised_absence", label: "Unauthorised absence" },
  { key: "written_warning", label: "Written warning" },
  { key: "damage_to_property", label: "Damage to company property" },
  { key: "other", label: "Other" },
];

const INCOMING_TYPES: Array<{
  type: (typeof INCOMING_TYPE_KEYS)[number];
  icon: LucideIcon;
  color: string;
  dot: string;
}> = [
  { type: "leave", icon: FileText, color: "bg-[#14B8A6]", dot: "bg-[#14B8A6]" },
  { type: "asset", icon: Package, color: "bg-[#7C3AED]", dot: "bg-[#7C3AED]" },
  { type: "fuel", icon: Fuel, color: "bg-[#F97316]", dot: "bg-[#F97316]" },
  { type: "fuel_refund", icon: FileText, color: "bg-[#FB923C]", dot: "bg-[#FB923C]" },
  { type: "loan", icon: CircleDollarSign, color: "bg-[#7C3AED]", dot: "bg-[#2563EB]" },
  { type: "complaint", icon: AlertCircle, color: "bg-[#EC4899]", dot: "bg-[#EF4444]" },
  { type: "document", icon: Folder, color: "bg-[#3B82F6]", dot: "bg-[#3B82F6]" },
  { type: "salary_justification", icon: Briefcase, color: "bg-[#EA580C]", dot: "bg-[#EA580C]" },
  { type: "sick_leave", icon: Cross, color: "bg-[#EF4444]", dot: "bg-[#22C55E]" },
];

function HubTile({
  href,
  icon: Icon,
  color,
  label,
  count,
  onClick,
}: {
  href?: string;
  icon: LucideIcon;
  color: string;
  label: string;
  count?: number;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={cn("relative grid size-16 place-items-center rounded-[22px]", color)}>
        <Icon className="size-7 text-white" aria-hidden />
        {count != null && count > 0 ? (
          <span className="absolute end-1.5 top-1 text-[11px] font-semibold tabular-nums text-white">
            {count > 999 ? "999+" : count}
          </span>
        ) : null}
      </span>
      <span className="w-full text-center text-[12px] font-medium leading-tight text-foreground">
        {label}
      </span>
    </>
  );

  const className =
    "relative flex flex-col items-center gap-2 transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]";

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
        "inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px]",
        selected
          ? "bg-muted font-semibold text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {selected ? <Check className="size-3.5" /> : null}
      {children}
    </button>
  );
}

function formatAge(
  iso: string,
  t: (key: string, values?: { n: number }) => string,
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (days <= 0) return t("ageToday");
  if (days === 1) return t("ageDay");
  return t("ageDays", { n: days });
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

function incomingFromLine(
  row: RequestListRow,
  t: (key: string, values?: { name: string; department?: string }) => string,
): string {
  if (row.is_confidential) return t("confidentialLine");
  const name = maskedListSender(false, row.driver_name, t("confidentialSender"));
  if (row.department_label) {
    return t("fromEmployeeDept", { name, department: row.department_label });
  }
  return t("fromEmployee", { name });
}

export function RcmV2HubShell() {
  const t = useTranslations("pages.rcmV2");
  const locale = useLocale();
  const { permissions, isSuperAdmin } = useAuth();
  const access = rcmAccessChips(permissions, isSuperAdmin);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "incoming" ? "incoming" : "outgoing";
  const { data: categories } = useEsignCategories();
  const { data: typeCounts } = useRequestTypeCounts();
  const batchesQuery = useEsignBatches();
  const recipientsQuery = useEsignTrackerRecipients();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [incomingFilter, setIncomingFilter] = useState<IncomingHubFilter>("all");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");

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
      return live.map((row) => ({ key: row.key, label: row.label_en }));
    }
    return FALLBACK_PENALTIES;
  }, [categories?.rows]);

  const counts = typeCounts?.counts ?? {};
  const incomingCount = incomingPendingTotal(counts);
  const flags = incomingHubListFlags(incomingFilter);
  const actionQuery = useAdminRequestsList({
    datePreset: "all",
    limit: 20,
    assignedToMe: flags.assignedToMe,
    forwardedToMe: flags.forwardedToMe,
    dueToday: flags.dueToday,
  });

  const actionRows = useMemo(() => {
    const rows = [...(actionQuery.data?.rows ?? [])];
    rows.sort((a, b) => {
      const delta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sort === "oldest" ? delta : -delta;
    });
    return rows.slice(0, 5);
  }, [actionQuery.data?.rows, sort]);

  const tracker = useMemo(
    () =>
      buildEsignTracker(
        batchesQuery.data?.rows ?? NO_BATCHES,
        recipientsQuery.data?.recipients ?? [],
      ),
    [batchesQuery.data?.rows, recipientsQuery.data?.recipients],
  );

  const recentBatches = tracker.slice(0, 3);
  const adminChips =
    tab === "incoming"
      ? RCM_ADMIN_CHIPS.filter((chip) => chip.id !== "templates")
      : RCM_ADMIN_CHIPS;

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4">
      <header className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold text-primary hover:bg-primary/10"
          >
            <LayoutDashboard className="size-3.5" aria-hidden />
            {t("backToDashboard")}
          </Link>
          <p className="text-[13px] font-semibold text-foreground">{t("breadcrumb")}</p>
        </div>
        <div className="flex items-stretch justify-center rounded-2xl bg-muted/70 p-1">
          <button
            type="button"
            onClick={() => router.replace("/employeedesk?tab=outgoing")}
            className={cn(
              "flex min-w-[200px] flex-col items-center rounded-xl px-4 py-1.5",
              tab === "outgoing" ? "bg-slate-950 text-white shadow-sm" : "text-muted-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
              <Send className="size-3.5" />
              {t("outgoing")}
            </span>
            <span className={cn("text-[10px]", tab === "outgoing" ? "text-white/70" : "text-muted-foreground")}>
              {t("outgoingHint")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => router.replace("/employeedesk?tab=incoming")}
            className={cn(
              "flex min-w-[200px] flex-col items-center rounded-xl px-4 py-1.5",
              tab === "incoming" ? "bg-slate-950 text-white shadow-sm" : "text-muted-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
              <Inbox className="size-3.5" />
              {t("incoming")}
              {incomingCount > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                    tab === "incoming" ? "bg-white/20" : "bg-muted",
                  )}
                >
                  {incomingCount}
                </span>
              ) : null}
            </span>
            <span className={cn("text-[10px]", tab === "incoming" ? "text-white/70" : "text-muted-foreground")}>
              {t("incomingHint")}
            </span>
          </button>
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <span className="text-[11px] text-muted-foreground">{t("yourAccess")}</span>
          {access.sender ? (
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold">
              {t("access.sender")}
            </span>
          ) : null}
          {access.receiver ? (
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold">
              {t("access.receiver")}
            </span>
          ) : null}
        </div>
      </header>

      {tab === "outgoing" ? (
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-start">
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold">{t("createFromTemplate")}</h2>
                  <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                    {t("youSend")}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">{t("templateHint")}</p>
              </div>
              <Link
                href="/employeedesk/esign/templates"
                className="shrink-0 text-[12px] font-semibold text-primary hover:bg-primary/10"
              >
                {t("seeAllTemplates")}
              </Link>
            </div>
            <div className="mt-5 grid grid-cols-4 gap-x-3 gap-y-6">
              {parents.map((tile) =>
                tile.key === "penalty" ? (
                  <div key={tile.key} className="relative">
                    <button
                      type="button"
                      className="relative flex flex-col items-center gap-2 transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
                      onClick={() => setPenaltyOpen((open) => !open)}
                      aria-expanded={penaltyOpen}
                      aria-label={t("penaltyMore")}
                    >
                      <span className={cn("relative grid size-16 place-items-center rounded-[22px]", tile.color)}>
                        <tile.icon className="size-7 text-white" aria-hidden />
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[12px] font-medium leading-tight text-foreground">
                        {tile.label}
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      </span>
                    </button>
                    {penaltyOpen ? (
                      <div className="absolute start-0 top-full z-10 mt-2 w-56 rounded-xl border border-border bg-card p-2 shadow-lg">
                        <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {t("penaltyCategory")}
                        </p>
                        {penaltyChildren.map((child) => (
                          <Link
                            key={child.key}
                            href={`/employeedesk/esign/send?category=${FALLBACK_PENALTIES.some((item) => item.key === child.key) ? "penalty" : child.key}`}
                            className="block rounded-lg px-2 py-1.5 text-start text-[12px] hover:bg-muted"
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <HubTile
                    key={tile.key}
                    href={`/employeedesk/esign/send?category=${tile.key}`}
                    icon={tile.icon}
                    color={tile.color}
                    label={tile.label}
                  />
                ),
              )}
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[15px] font-semibold">{t("sendToMany")}</h2>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("sendToManyHint")}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  className="h-9 bg-slate-950 text-white hover:bg-slate-800"
                  render={<Link href="/employeedesk/esign/bulk" />}
                >
                  <Plus className="size-3.5" />
                  {t("importExcel")}
                </Button>
                <button
                  type="button"
                  className="text-[12px] font-semibold text-foreground underline-offset-2 hover:underline"
                  onClick={() => downloadGenericExampleSheet()}
                >
                  {t("downloadExample")}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold">{t("sentForSignature")}</h2>
                <Link
                  href="/requests/esign/batches"
                  className="text-[12px] font-semibold text-primary hover:bg-primary/10"
                >
                  {t("viewAll")}
                </Link>
              </div>
              {recentBatches.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-muted-foreground">
                  {t("emptyBatches")}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {recentBatches.map((row) => {
                    const done = row.stage === "completed";
                    const total = row.progress.total || row.batch.total_count;
                    const signed = row.progress.signed;
                    const percent = Math.round(row.progress.percent);
                    const sent = formatSentDate(row.batch.created_at, locale);
                    const bulk = Boolean(row.batch.source_filename);
                    return (
                      <div key={row.batch.id} className="flex items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold">
                            {row.batch.title || row.batch.template_name || row.batch.batch_code}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {bulk
                              ? t("batchEmployeesBulk", { count: total, date: sent })
                              : t("batchEmployees", { count: total, date: sent })}
                          </p>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${Math.min(100, percent)}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {done ? (
                            <span className="text-[12px] font-semibold text-emerald-600">
                              {t("completed")}
                            </span>
                          ) : (
                            <>
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                {t("signedOf", { signed, total, percent })}
                              </span>
                              <Link
                                href={`/requests/esign/batches/${row.batch.id}`}
                                className="text-[11px] font-bold uppercase tracking-wide text-primary hover:bg-primary/10"
                              >
                                {t("track")}
                              </Link>
                            </>
                          )}
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
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-5 flex items-center gap-2">
              <h2 className="text-[15px] font-semibold">{t("queuesWaiting")}</h2>
              <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-950">
                {t("youReceive")}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-6">
              {INCOMING_TYPES.map((tile) => (
                <HubTile
                  key={tile.type}
                  href={`/employeedesk/all?type=${tile.type}&preset=all`}
                  icon={tile.icon}
                  color={tile.color}
                  label={t(`types.${tile.type}` as "types.leave")}
                  count={counts[tile.type]?.pending}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{t("needsAction")}</h2>
              <Button
                className="h-9 bg-slate-950 text-white hover:bg-slate-800"
                onClick={() => setUploadOpen(true)}
              >
                {t("uploadDocument")}
              </Button>
            </div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-0.5">
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
              <Select
                items={[
                  { value: "oldest", label: t("oldestFirst") },
                  { value: "newest", label: t("newestFirst") },
                ]}
                value={sort}
                onValueChange={(value) => {
                  if (value === "oldest" || value === "newest") setSort(value);
                }}
              >
                <SelectTrigger className="h-8 w-[130px] border-0 bg-transparent shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oldest" label={t("oldestFirst")}>
                    {t("oldestFirst")}
                  </SelectItem>
                  <SelectItem value="newest" label={t("newestFirst")}>
                    {t("newestFirst")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {actionRows.length === 0 ? (
              <p className="py-10 text-center text-[12px] text-muted-foreground">
                {t("emptyAction")}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {actionRows.map((row) => {
                  const typeMeta = INCOMING_TYPES.find((item) => item.type === row.request_type);
                  return (
                    <div key={row.id} className="flex items-center gap-3 py-3">
                      <span className={cn("size-2 shrink-0 rounded-full", typeMeta?.dot ?? "bg-slate-400")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold">
                          {t(`types.${row.request_type}` as "types.leave")}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {incomingFromLine(row, t)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatAge(row.created_at, t)}
                      </span>
                      <Link
                        href={`/employeedesk/${row.id}`}
                        className="shrink-0 text-[12px] font-semibold text-primary hover:bg-primary/10"
                      >
                        {t("review")}
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-4 text-[11px] text-muted-foreground">{t("incomingFootnote")}</p>
          </section>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("adminOnly")}
        </span>
        {adminChips.map((chip) => (
          <Link
            key={chip.id}
            href={chip.href}
            className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold hover:bg-muted"
          >
            {t(`admin.${chip.id}` as "admin.templates")}
          </Link>
        ))}
      </footer>
      <IncomingUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}
