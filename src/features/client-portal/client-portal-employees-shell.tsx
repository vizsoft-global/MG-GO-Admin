"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [query, setQuery] = useState("");
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

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.mgId, row.clientId, row.fullName, row.civilId, statusLabel(row.status)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, rows]);

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
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDocument")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colNumber")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colExpiry")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colFile")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="text-[var(--portal-ink)]">
                      {doc.labelKey ? docT(doc.labelKey) : doc.label}
                    </TableCell>
                    <TableCell>{doc.number}</TableCell>
                    <TableCell>{doc.expiry || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={documentBadgeVariant(doc.status)}>
                        {doc.status === "expired" ? t("docExpired") : t("docValid")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="portal-secondary"
                          className="h-9 cursor-pointer"
                          onClick={() => void openDocument(doc, "view")}
                        >
                          <ExternalLink className="size-4" />
                          {t("docView")}
                        </Button>
                        <Button
                          variant="portal-neutral"
                          className="h-9 cursor-pointer"
                          onClick={() => void openDocument(doc, "read")}
                        >
                          <Download className="size-4" />
                          {t("docDownload")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-[var(--portal-muted)]">
              <span className="inline-flex items-center gap-1">
                <Search className="size-4" />
                {t("searchEmployees")}
              </span>
              <Input className={field} value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>
          {failed ? <ErrorState title={t("employeesLoadFailed")} /> : null}
          {loading ? <p className="text-sm text-[var(--portal-muted)]">{t("loading")}</p> : null}
          {!loading && !failed && shown.length === 0 ? (
            <EmptyState title={t("employeesEmpty")} />
          ) : null}
          {shown.length > 0 ? (
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colMgId")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colClientId")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colFullName")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colCivilId")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDocuments")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.mgId || "—"}</TableCell>
                    <TableCell>{row.clientId || "—"}</TableCell>
                    <TableCell className="font-medium text-[var(--portal-ink)]">{row.fullName || "—"}</TableCell>
                    <TableCell>{row.civilId || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(row.status)}>{statusLabel(row.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="portal-secondary"
                        className="h-9 cursor-pointer"
                        onClick={() => go({ employee: row.id })}
                      >
                        <ExternalLink className="size-4" />
                        {t("viewDocuments")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </section>
      )}
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
