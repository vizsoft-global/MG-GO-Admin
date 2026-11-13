"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, Eye, FileText, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AppBackButton } from "@/components/app/app-back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKuwaitDateLabel } from "@/lib/date/kuwait-dates";
import {
  fetchClientPortalDocuments,
  fetchClientPortalEmployees,
  logClientPortalDocument,
  type ClientPortalDocument,
  type ClientPortalEmployee,
} from "@/features/client-portal/client-portal-employees-actions";
import { portalInitials } from "./portal-v2-nav";
import { pageSlice, pageWindow } from "./portal-rider-widgets";

const HEAD_BTN = "h-9 cursor-pointer";
const TABLE = "text-[13px] [&_thead_tr]:bg-[var(--surface-subtle)] [&_td]:px-3 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-3";
const TH = "text-start text-[12px] font-medium text-[var(--text-secondary)]";
/** Rows per page. 8 is what the card was already showing, so the height holds. */
const PAGE_SIZE = 8;

function maskedCivil(civilId: string): string {
  if (!civilId) return "—";
  return `•••••• ${civilId.slice(-4)}`;
}

function statusClass(status: string): string {
  if (/leave/i.test(status)) return "bg-[var(--status-leave-bg)] text-[var(--status-leave-fg)]";
  if (/absent|sick/i.test(status)) return "bg-[var(--status-sick-bg)] text-[var(--status-sick-fg)]";
  if (/work|active/i.test(status)) return "bg-[var(--status-working-bg)] text-[var(--status-working-fg)]";
  return "bg-[var(--surface-subtle)] text-[var(--text-secondary)]";
}

export function ClientEmployeesV2({ project }: { project: string }) {
  const t = useTranslations("pages.clientPortalV2");
  const tOps = useTranslations("pages.operationsDashboardV2");
  const [rows, setRows] = useState<ClientPortalEmployee[]>([]);
  const [documents, setDocuments] = useState<ClientPortalDocument[]>([]);
  const [selected, setSelected] = useState<ClientPortalEmployee | null>(null);
  const [query, setQuery] = useState("");
  const [revealCivil, setRevealCivil] = useState(false);
  const [page, setPage] = useState(0);

  const projectLabel =
    project === "americana"
      ? tOps("projectAmericana")
      : project === "unassigned"
        ? tOps("projectUnassigned")
        : tOps("projectKeeta");

  useEffect(() => {
    let cancelled = false;
    void fetchClientPortalEmployees({ project }).then((result) => {
      if (!cancelled) setRows(result.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  const openEmployee = useCallback(
    (employee: ClientPortalEmployee) => {
      setSelected(employee);
      setRevealCivil(false);
      setDocuments([]);
      void fetchClientPortalDocuments({ intakeId: employee.id, project }).then((result) => {
        setDocuments(result.documents);
      });
    },
    [project],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.fullName.toLowerCase().includes(needle) ||
        row.mgId.toLowerCase().includes(needle) ||
        row.civilId.includes(needle),
    );
  }, [rows, query]);

  /**
   * A real page over the loaded roster, not the old `slice(0, 8)`.
   *
   * `fetchClientPortalEmployees` already pages the whole project into `rows`, so
   * this is a view over data the card had all along — the footer used to print
   * `1–8 / 209` and stop, which reads as a pager that does nothing.
   */
  const paged = pageSlice(filtered, page, PAGE_SIZE);

  async function openDocument(doc: ClientPortalDocument, mode: "view" | "download") {
    if (!selected) return;
    await logClientPortalDocument({
      intakeId: selected.id,
      project,
      label: doc.label,
      kind: mode === "view" ? "view" : "read",
    });
    if (doc.signedUrl) window.open(doc.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-4">
      <AppBackButton fallbackHref="/client-portal-v2" />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--accent-rust)] text-sm font-semibold text-white">
            {portalInitials(projectLabel)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[26px] font-bold leading-8 text-[var(--text-primary)]">{projectLabel}</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-working-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-working-fg)]">
                <span className="size-1.5 rounded-full bg-[var(--status-working-fg)]" aria-hidden />
                {t("statusActive")}
              </span>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              {t("employeesSubtitle", { count: rows.length, project: projectLabel })}
            </p>
          </div>
        </div>
        <Button
          variant="portal-secondary"
          className={HEAD_BTN}
          render={<Link href={`/client-portal-v2/preview/${project}`} />}
        >
          <Eye className="size-4" aria-hidden />
          {t("previewAsClient")}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border-default)] text-sm">
        <span className="border-b-2 border-[var(--accent-rust)] pb-2 font-medium text-[var(--accent-rust)]">
          {t("employeesTitle")} {rows.length}
        </span>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl bg-[var(--status-leave-bg)] px-4 py-3 text-[13px] text-[var(--status-leave-fg)]">
        <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">{t("sessionNote", { client: projectLabel })}</p>
          <p className="text-[12px] opacity-80">{t("sessionNoteBody")}</p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-[16px] font-bold leading-6 text-[var(--text-primary)]">
                {t("employeesTitle")}
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {t("employeesSubtitle", { count: rows.length, project: projectLabel })}
              </p>
            </div>
            <span className="relative">
              <Search
                className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-[var(--text-muted)]"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  // A search that shrinks the roster must not leave the view on
                  // a page that no longer exists.
                  setPage(0);
                }}
                placeholder={t("searchEmployees")}
                className="h-9 w-60 border-[var(--border-default)] bg-[var(--surface-card)] ps-8"
              />
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <Table className={TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH}>{t("colMgId")}</TableHead>
                  <TableHead className={TH}>{t("colClientId")}</TableHead>
                  <TableHead className={TH}>{t("colFullName")}</TableHead>
                  <TableHead className={TH}>{t("colCivilId")}</TableHead>
                  <TableHead className={TH}>{t("colStatus")}</TableHead>
                  <TableHead className={TH} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.slice.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-[var(--text-secondary)]">
                      {t("noDocuments")}
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.slice.map((row) => (
                    <TableRow key={row.id} onClick={() => openEmployee(row)} className="cursor-pointer">
                      <TableCell className="tabular-nums">{row.mgId || "—"}</TableCell>
                      <TableCell className="tabular-nums">{row.clientId || "—"}</TableCell>
                      <TableCell className="font-medium">{row.fullName}</TableCell>
                      <TableCell className="tabular-nums">{maskedCivil(row.civilId)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass(row.status)}`}>
                          <span
                            className={
                              /leave/i.test(row.status)
                                ? "size-1.5 rounded-full bg-[var(--status-leave-fg)]"
                                : /absent|sick/i.test(row.status)
                                  ? "size-1.5 rounded-full bg-[var(--status-sick-fg)]"
                                  : "size-1.5 rounded-full bg-[var(--status-working-fg)]"
                            }
                            aria-hidden
                          />
                          {row.status || t("notMarked")}
                        </span>
                      </TableCell>
                      <TableCell className="text-end">
                        <ChevronRight className="ms-auto size-4 text-[var(--text-muted)]" aria-hidden />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span>
              {filtered.length === 0
                ? "0"
                : t("pagerRange", { from: paged.from, to: paged.to, total: filtered.length })}
            </span>
            {paged.pageCount > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={paged.page === 0}
                  onClick={() => setPage(paged.page - 1)}
                  className="inline-flex h-7 cursor-pointer items-center rounded-md border border-[var(--border-default)] px-2 font-medium text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40"
                >
                  {t("pagerPrev")}
                </button>
                {pageWindow(paged.page, paged.pageCount).map((index, position) =>
                  index == null ? (
                    <span key={`gap-${position}`} className="px-1">
                      …
                    </span>
                  ) : (
                    <button
                      key={index}
                      type="button"
                      aria-current={index === paged.page ? "page" : undefined}
                      onClick={() => setPage(index)}
                      className={`inline-flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-md border px-2 tabular-nums ${
                        index === paged.page
                          ? "border-[var(--accent-rust)] bg-[var(--accent-rust)] font-semibold text-white"
                          : "border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
                      }`}
                    >
                      {index + 1}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={paged.page >= paged.pageCount - 1}
                  onClick={() => setPage(paged.page + 1)}
                  className="inline-flex h-7 cursor-pointer items-center rounded-md border border-[var(--border-default)] px-2 font-medium text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40"
                >
                  {t("pagerNext")}
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--selected-navy)] text-xs font-semibold text-white">
                    {portalInitials(selected.fullName)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-display text-[16px] font-bold text-[var(--text-primary)]">
                      {selected.fullName}
                    </p>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      {selected.mgId || "—"} · {selected.status || t("notMarked")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="grid size-7 cursor-pointer place-items-center rounded-md border border-[var(--border-default)]"
                  aria-label="Close"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--border-default)] text-[13px]">
                <DetailCell label={t("colMgId")} value={selected.mgId || "—"} />
                <DetailCell label={t("colClientId")} value={selected.clientId || "—"} borderStart />
                <DetailCell
                  label={t("colCivilId")}
                  value={revealCivil ? selected.civilId || "—" : maskedCivil(selected.civilId)}
                  action={
                    <button
                      type="button"
                      onClick={() => setRevealCivil((value) => !value)}
                      className="text-[11px] font-semibold text-[var(--accent-rust)]"
                    >
                      {t("showCivilId")}
                    </button>
                  }
                  borderTop
                />
                <DetailCell label={t("civilIdExpiry")} value="—" borderStart borderTop />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-[15px] font-bold text-[var(--text-primary)]">{t("documentDetails")}</p>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    {t("filesCount", { count: documents.length })}
                  </p>
                </div>
                <Button
                  variant="portal-secondary"
                  className={HEAD_BTN}
                  disabled={documents.length === 0}
                  onClick={() => {
                    for (const doc of documents) void openDocument(doc, "download");
                  }}
                >
                  <Download className="size-4" aria-hidden />
                  {t("downloadAll")}
                </Button>
              </div>

              <ul className="mt-3 divide-y divide-[var(--border-default)]">
                {documents.length === 0 ? (
                  <li className="py-4 text-center text-[13px] text-[var(--text-secondary)]">{t("noDocuments")}</li>
                ) : (
                  documents.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-3 py-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-subtle)]">
                        <FileText className="size-4 text-[var(--text-secondary)]" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{doc.label}</p>
                        <p className="truncate text-[11px] text-[var(--text-secondary)]">
                          {doc.expiry ? formatKuwaitDateLabel(doc.expiry) : "—"}
                        </p>
                      </div>
                      <span
                        className={
                          doc.status === "expired"
                            ? "rounded-full bg-[var(--status-absent-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-absent-fg)]"
                            : "rounded-full bg-[var(--status-working-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-working-fg)]"
                        }
                      >
                        {doc.status === "expired" ? t("docExpired") : t("valid")}
                      </span>
                      <button
                        type="button"
                        className="grid size-7 cursor-pointer place-items-center rounded-md border border-[var(--border-default)]"
                        onClick={() => void openDocument(doc, "view")}
                        aria-label={t("viewDocument")}
                        title={t("viewDocument")}
                      >
                        <Eye className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="grid size-7 cursor-pointer place-items-center rounded-md border border-[var(--border-default)]"
                        onClick={() => void openDocument(doc, "download")}
                        aria-label={t("downloadDocument")}
                        title={t("downloadDocument")}
                      >
                        <Download className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <p className="mt-3 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                {t("docsPrivacy")}
              </p>
            </>
          ) : (
            <p className="py-10 text-center text-[13px] text-[var(--text-secondary)]">{t("employeeDetails")}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function DetailCell({
  label,
  value,
  action,
  borderStart,
  borderTop,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
  borderStart?: boolean;
  borderTop?: boolean;
}) {
  return (
    <div
      className={[
        "px-3 py-2.5",
        borderStart ? "border-s border-[var(--border-default)]" : "",
        borderTop ? "border-t border-[var(--border-default)]" : "",
      ].join(" ")}
    >
      <p className="text-[11px] text-[var(--text-secondary)]">{label}</p>
      <p className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
        <span className="truncate">{value}</span>
        {action}
      </p>
    </div>
  );
}

