"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { AppPage } from "@/components/app/app-page";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
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

const card = "rounded-xl border bg-white p-4";

function statusLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  return trimmed.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
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
    <AppPage className="space-y-6 bg-[#f4f5f7]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="type-h1 text-[#1f2328]">{t("employeesTitle")}</h1>
        <ClientPortalNav />
      </div>

      {employeeId ? (
        <section className={card} style={{ borderColor: "#e3e5e8" }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <button type="button" className="cursor-pointer text-xs text-[#A73C24]" onClick={() => go({ employee: null })}>
                {t("backToEmployees")}
              </button>
              <h2 className="text-sm font-semibold text-[#1f2328]">
                {selected ? `${selected.mgId || "—"} ${selected.fullName}`.trim() : t("documentsTitle")}
              </h2>
            </div>
            <Button
              variant="outline"
              className="h-9 cursor-pointer"
              style={{ borderColor: "#A73C24", color: "#A73C24" }}
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
          {docsFailed ? <p className="text-sm text-destructive">{t("employeesLoadFailed")}</p> : null}
          {docsLoading ? <p className="text-sm text-[#5c6370]">{t("loading")}</p> : null}
          {!docsLoading && !docsFailed && documents.length === 0 ? (
            <p className="text-sm text-[#5c6370]">{t("documentsEmpty")}</p>
          ) : null}
          {documents.length > 0 ? (
            <Table>
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
                    <TableCell>{doc.labelKey ? docT(doc.labelKey) : doc.label}</TableCell>
                    <TableCell>{doc.number}</TableCell>
                    <TableCell>{doc.expiry || "—"}</TableCell>
                    <TableCell>{doc.status === "expired" ? t("docExpired") : t("docValid")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          className="h-9 cursor-pointer text-primary hover:bg-primary/10"
                          onClick={() => void openDocument(doc, "view")}
                        >
                          <ExternalLink className="size-4" />
                          {t("docView")}
                        </Button>
                        <Button
                          variant="outline"
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
        <section className={card} style={{ borderColor: "#e3e5e8" }}>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            {readOnlyProject ? null : (
              <label className="flex flex-col gap-1 text-xs text-[#5c6370]">
                {t("projectPreview")}
                <Select
                  items={projectItems}
                  value={project}
                  onValueChange={(value) => {
                    if (value) go({ project: value, employee: null });
                  }}
                >
                  <SelectTrigger className="h-9 w-40">
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
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-[#5c6370]">
              <span className="inline-flex items-center gap-1">
                <Search className="size-4" />
                {t("searchEmployees")}
              </span>
              <Input className="h-9" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>
          {failed ? <p className="text-sm text-destructive">{t("employeesLoadFailed")}</p> : null}
          {loading ? <p className="text-sm text-[#5c6370]">{t("loading")}</p> : null}
          {!loading && !failed && shown.length === 0 ? (
            <p className="text-sm text-[#5c6370]">{t("employeesEmpty")}</p>
          ) : null}
          {shown.length > 0 ? (
            <Table>
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
                    <TableCell>{row.fullName || "—"}</TableCell>
                    <TableCell>{row.civilId || "—"}</TableCell>
                    <TableCell>{statusLabel(row.status)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        className="h-9 cursor-pointer text-primary hover:bg-primary/10"
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
    </AppPage>
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
