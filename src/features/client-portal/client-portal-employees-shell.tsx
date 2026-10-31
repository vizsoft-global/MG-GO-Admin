"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { EmptyCell, TableGridCards, TableNameCell, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import type { FrameStatus } from "@/components/app/status-badge";
import { groupBanner, groupRows, ListToolbar, rowMatches, visibleColumnIds } from "@/features/roster/table-kit";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { PARTNER_PROJECT_KEYS, type PartnerProjectKey } from "@/lib/auth/staff-access";
import { selectOptions } from "@/lib/select-items";
import { ClientPortalNav } from "./client-portal-nav";
import {
  fetchClientPortalDocuments,
  fetchClientPortalEmployees,
  logClientPortalDocument,
  type ClientPortalDocument,
  type ClientPortalEmployee,
} from "./client-portal-employees-actions";

const card = "rounded-xl border border-[var(--portal-border)] bg-[var(--portal-canvas)] p-4";
const field =
  "h-9 border-[var(--portal-border)] bg-[var(--portal-canvas)] text-[var(--portal-ink)] focus-visible:border-[var(--portal-btn)] focus-visible:ring-[var(--portal-btn)]/40";

function statusLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  return trimmed.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusBadgeVariant(
  value: string,
): "portal-green" | "portal-blue" | "portal-red" | "portal-ochre" | "portal-grey" {
  const key = value.trim().toLowerCase();
  if (!key) return "portal-grey";
  if (key.includes("cancel") || key.includes("absent") || key.includes("hold") || key === "inactive") {
    return "portal-red";
  }
  if (key.includes("leave") || key.includes("sick")) return "portal-blue";
  if (key.includes("train") || key === "new") return "portal-ochre";
  if (key.includes("run") || key.includes("active") || key.includes("extension") || key.includes("work")) {
    return "portal-green";
  }
  return "portal-grey";
}

function documentBadgeVariant(status: ClientPortalDocument["status"]): "portal-green" | "portal-red" {
  switch (status) {
    case "valid":
      return "portal-green";
    case "expired":
      return "portal-red";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function openSigned(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function isPartnerProjectKey(value: string): value is PartnerProjectKey {
  return (PARTNER_PROJECT_KEYS as readonly string[]).includes(value);
}

export function ClientPortalEmployeesShell({
  project,
  employeeId,
}: {
  project: string;
  employeeId: string;
}) {
  const t = useTranslations("pages.clientPortal");
  const docT = useTranslations("pages.drivers.documents");
  const router = useRouter();
  const { accessKind } = useAuth();
  const readOnlyProject = accessKind === "partner";
  const employeeColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "mgId", label: t("colMgId"), locked: true },
      { id: "clientId", label: t("colClientId") },
      { id: "fullName", label: t("colFullName"), locked: true },
      { id: "civilId", label: t("colCivilId") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "documents", label: t("colDocuments"), locked: true },
    ],
    [t],
  );
  const documentColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "document", label: t("colDocument"), locked: true },
      { id: "number", label: t("colNumber") },
      { id: "expiry", label: t("colExpiry") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "file", label: t("colFile"), locked: true },
    ],
    [t],
  );
  const employeePrefs = useTablePrefs("clientPortal.employees", employeeColumns);
  const documentPrefs = useTablePrefs("clientPortal.documents", documentColumns);
  const [rows, setRows] = useState<ClientPortalEmployee[]>([]);
  const [documents, setDocuments] = useState<ClientPortalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsFailed, setDocsFailed] = useState(false);

  const projectItems = selectOptions(
    PARTNER_PROJECT_KEYS.map((key) => ({
      value: key,
      label: t(projectLabelKey(key)),
    })),
  );
  const projectLabel = isPartnerProjectKey(project) ? t(projectLabelKey(project)) : project;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchClientPortalEmployees({ project }).then((result) => {
      if (cancelled) return;
      setRows(result.rows);
      setFailed(result.failed);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    if (!employeeId) {
      setDocuments([]);
      setDocsFailed(false);
      return;
    }
    let cancelled = false;
    setDocsLoading(true);
    void fetchClientPortalDocuments({ intakeId: employeeId, project }).then((result) => {
      if (cancelled) return;
      setDocuments(result.documents);
      setDocsFailed(result.failed);
      setDocsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId, project]);

  const shown = useMemo(
    () =>
      rows.filter((row) =>
        rowMatches(employeePrefs.appliedQuery, [row.mgId, row.clientId, row.fullName, row.civilId, statusLabel(row.status)]),
      ),
    [employeePrefs.appliedQuery, rows],
  );

  const selected = rows.find((row) => row.id === employeeId) ?? null;
  const validDocuments = documents.filter((doc) => doc.status === "valid").length;
  const expiredDocuments = documents.filter((doc) => doc.status === "expired").length;

  function go(next: { project?: string; employee?: string | null }) {
    const params = new URLSearchParams();
    params.set("project", next.project ?? project);
    if (next.employee) params.set("employee", next.employee);
    router.push(`/client-portal/employees?${params.toString()}`);
  }

  async function openDocument(doc: ClientPortalDocument, kind: "view" | "read") {
    const result = await logClientPortalDocument({
      intakeId: employeeId,
      label: doc.labelKey ?? doc.label,
      kind,
      project,
    });
    if (!result.ok) {
      toast.error(t("employeesLoadFailed"));
      return;
    }
    openSigned(doc.signedUrl);
  }

  return (
    <div className="min-h-0 space-y-4 bg-[var(--portal-canvas)] p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-h1 text-[var(--portal-ink)]">{t("employeesTitle")}</h1>
          <p className="text-sm text-[var(--portal-muted)]">{projectLabel}</p>
        </div>
        <ClientPortalNav projectLabel={projectLabel} previewProjectKey={readOnlyProject ? undefined : project} />
      </div>

      <p className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-badge-blue-bg)] px-4 py-2 text-sm text-[var(--portal-ink)]">
        {t("privacyBanner")}
      </p>

      {employeeId ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard layout="portal" portalAccent="plum" label={t("documentsTitle")} value={documents.length} />
          <KpiCard layout="portal" portalAccent="green" label={t("docValid")} value={validDocuments} />
          <KpiCard layout="portal" portalAccent="red" label={t("docExpired")} value={expiredDocuments} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <KpiCard layout="portal" portalAccent="plum" label={t("employeesTitle")} value={rows.length} />
          <KpiCard layout="portal" portalAccent="blue" label={t("projectPreview")} value={projectLabel} />
        </div>
      )}

      {employeeId ? (
        <section className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <button
                type="button"
                className="cursor-pointer text-xs font-medium text-[var(--portal-btn)]"
                onClick={() => go({ employee: null })}
              >
                {t("backToEmployees")}
              </button>
              <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
                {selected ? `${selected.mgId || "—"} ${selected.fullName}`.trim() : t("documentsTitle")}
              </h2>
            </div>
            <Button
              variant="portal"
              className="h-9 cursor-pointer"
              disabled={documents.length === 0 || docsLoading}
              onClick={() => {
                void (async () => {
                  for (const doc of documents) await openDocument(doc, "read");
                })();
              }}
            >
              <Download className="size-4" />
              {t("downloadAll")}
            </Button>
          </div>
          {docsFailed ? <ErrorState title={t("employeesLoadFailed")} /> : null}
          {docsLoading ? <p className="text-sm text-[var(--portal-muted)]">{t("loading")}</p> : null}
          {!docsLoading && !docsFailed && documents.length === 0 ? (
            <EmptyState title={t("documentsEmpty")} />
          ) : null}
          {documents.length > 0 ? (
            <DocumentTable
              columns={documentColumns}
              prefs={documentPrefs}
              documents={documents}
              labelOf={(doc) => (doc.labelKey ? docT(doc.labelKey) : doc.label)}
              statusLabel={(status) => (status === "expired" ? t("docExpired") : t("docValid"))}
              viewLabel={t("docView")}
              downloadLabel={t("docDownload")}
              onOpen={(doc, kind) => void openDocument(doc, kind)}
            />
          ) : null}
        </section>
      ) : (
        <section className={card}>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            {readOnlyProject ? null : (
              <label className="flex flex-col gap-1 text-xs text-[var(--portal-muted)]">
                {t("projectPreview")}
                <Select
                  items={projectItems}
                  value={project}
                  onValueChange={(value) => {
                    if (value) go({ project: value, employee: null });
                  }}
                >
                  <SelectTrigger className={field + " w-40"}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projectItems.map((item) => (
                      <SelectItem key={String(item.value)} value={String(item.value)}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>
          {failed ? <ErrorState title={t("employeesLoadFailed")} /> : null}
          {loading ? <p className="text-sm text-[var(--portal-muted)]">{t("loading")}</p> : null}
          {!loading && !failed && shown.length === 0 ? (
            <EmptyState title={t("employeesEmpty")} />
          ) : null}
          <EmployeeTable
            columns={employeeColumns}
            prefs={employeePrefs}
            rows={shown}
            total={rows.length}
            entity={t("searchEmployees")}
            documentsLabel={t("viewDocuments")}
            onOpen={(id) => go({ employee: id })}
          />
        </section>
      )}
    </div>
  );
}

function frameStatus(value: string): FrameStatus {
  const key = value.trim().toLowerCase();
  if (key.includes("leave")) return "leave";
  if (key.includes("sick")) return "sick";
  if (key.includes("absent")) return "absent";
  if (key.includes("pending")) return "pending";
  if (key.includes("accident")) return "accident";
  if (key.includes("run") || key.includes("active") || key.includes("work")) return "working";
  return "neutral";
}

function EmployeeTable({
  columns,
  prefs,
  rows,
  total,
  entity,
  documentsLabel,
  onOpen,
}: {
  columns: TableToolbarColumn[];
  prefs: ReturnType<typeof useTablePrefs>;
  rows: ClientPortalEmployee[];
  total: number;
  entity: string;
  documentsLabel: string;
  onOpen: (id: string) => void;
}) {
  const ids = visibleColumnIds(prefs);
  const groups = groupRows(rows, prefs.groupBy, (row) => (prefs.groupBy === "status" ? statusLabel(row.status) : ""));
  return (
    <div>
      <ListToolbar
        prefs={prefs}
        entity={entity}
        columns={columns}
        rowKind="dynamic"
        entityList
        filteredCount={rows.length}
        totalCount={total}
      />
      {prefs.view === "grid" ? (
        <TableGridCards
          rows={rows.map((row) => ({
            id: row.mgId || row.id,
            name: row.fullName,
            status: { status: frameStatus(row.status), label: statusLabel(row.status) },
            fields: [
              { label: columns.find((column) => column.id === "clientId")?.label ?? "", value: row.clientId || "—" },
              { label: columns.find((column) => column.id === "civilId")?.label ?? "", value: row.civilId || "—" },
            ],
            onOpen: () => onOpen(row.id),
          }))}
        />
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              {ids.map((id) => (
                <TableHead key={id} className={TABLE_HEAD_CLASS}>
                  {columns.find((column) => column.id === id)?.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {group.label ? (
                  <TableRow>
                    <TableCell colSpan={ids.length} className="bg-muted/40 text-xs font-semibold">
                      {groupBanner(group.label, group.rows.length)}
                    </TableCell>
                  </TableRow>
                ) : null}
                {group.rows.map((row) => (
                  <TableRow key={row.id}>
                    {ids.map((id) => (
                      <TableCell key={id}>
                        {id === "mgId" ? (row.mgId ? row.mgId : <EmptyCell />) : null}
                        {id === "clientId" ? (row.clientId ? row.clientId : <EmptyCell />) : null}
                        {id === "fullName" ? <TableNameCell name={row.fullName} /> : null}
                        {id === "civilId" ? (row.civilId ? row.civilId : <EmptyCell />) : null}
                        {id === "status" ? <Badge variant={statusBadgeVariant(row.status)}>{statusLabel(row.status)}</Badge> : null}
                        {id === "documents" ? (
                          <Button variant="portal-secondary" className="h-9 cursor-pointer" onClick={() => onOpen(row.id)}>
                            <ExternalLink className="size-4" />
                            {documentsLabel}
                          </Button>
                        ) : null}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function DocumentTable({
  columns,
  prefs,
  documents,
  labelOf,
  statusLabel: statusText,
  viewLabel,
  downloadLabel,
  onOpen,
}: {
  columns: TableToolbarColumn[];
  prefs: ReturnType<typeof useTablePrefs>;
  documents: ClientPortalDocument[];
  labelOf: (doc: ClientPortalDocument) => string;
  statusLabel: (status: ClientPortalDocument["status"]) => string;
  viewLabel: string;
  downloadLabel: string;
  onOpen: (doc: ClientPortalDocument, kind: "view" | "read") => void;
}) {
  const matched = documents.filter((doc) =>
    rowMatches(prefs.appliedQuery, [labelOf(doc), doc.number, doc.expiry, doc.status]),
  );
  const groups = groupRows(matched, prefs.groupBy, (doc) => (prefs.groupBy === "status" ? statusText(doc.status) : ""));
  const ids = visibleColumnIds(prefs);
  return (
    <div>
      <ListToolbar
        prefs={prefs}
        entity={columns[0]?.label ?? "documents"}
        columns={columns}
        rowKind="dynamic"
        filteredCount={matched.length}
        totalCount={documents.length}
      />
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            {ids.map((id) => (
              <TableHead key={id} className={TABLE_HEAD_CLASS}>
                {columns.find((column) => column.id === id)?.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              {group.label ? (
                <TableRow>
                  <TableCell colSpan={ids.length} className="bg-muted/40 text-xs font-semibold">
                    {groupBanner(group.label, group.rows.length)}
                  </TableCell>
                </TableRow>
              ) : null}
              {group.rows.map((doc) => (
                <TableRow key={doc.id}>
                  {ids.map((id) => (
                    <TableCell key={id}>
                      {id === "document" ? <span className="text-[var(--portal-ink)]">{labelOf(doc)}</span> : null}
                      {id === "number" ? (doc.number ? doc.number : <EmptyCell />) : null}
                      {id === "expiry" ? (doc.expiry ? doc.expiry : <EmptyCell />) : null}
                      {id === "status" ? (
                        <Badge variant={documentBadgeVariant(doc.status)}>{statusText(doc.status)}</Badge>
                      ) : null}
                      {id === "file" ? (
                        <div className="flex gap-1">
                          <Button variant="portal-secondary" className="h-9 cursor-pointer" onClick={() => onOpen(doc, "view")}>
                            <ExternalLink className="size-4" />
                            {viewLabel}
                          </Button>
                          <Button variant="portal-neutral" className="h-9 cursor-pointer" onClick={() => onOpen(doc, "read")}>
                            <Download className="size-4" />
                            {downloadLabel}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function projectLabelKey(key: PartnerProjectKey): "projectKeeta" | "projectAmericana" | "projectUnassigned" {
  switch (key) {
    case "keeta":
      return "projectKeeta";
    case "americana":
      return "projectAmericana";
    case "unassigned":
      return "projectUnassigned";
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}
