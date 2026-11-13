"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Pencil, Plus, Search, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppBackButton } from "@/components/app/app-back-button";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fetchPortalDirectory, type PortalDirectoryRow } from "./portal-v2-actions";
import {
  PORTAL_SECTION_KEYS,
  emptyPortalConfig,
  type PortalConfig,
  type PortalSectionKey,
  type PortalUserRole,
} from "./portal-config";
import { fetchPortalConfigs, savePortalSections, savePortalUsers } from "./portal-config-actions";
import { portalInitials } from "./portal-v2-nav";

const HEAD_BTN = "h-9 cursor-pointer";
const TABLE = "text-[13px] [&_thead_tr]:bg-[var(--surface-subtle)] [&_td]:px-3 [&_td]:py-3 [&_th]:h-9 [&_th]:px-3";
const TH = "text-start text-[12px] font-medium text-[var(--text-secondary)]";
const PROJECT_KEYS = ["keeta", "americana", "unassigned"] as const;

type Tab = "clients" | "users" | "visibility";

function sectionLabel(key: PortalSectionKey, t: ReturnType<typeof useTranslations<"pages.clientPortalV2">>): string {
  switch (key) {
    case "riderStatus":
      return t("riderStatus");
    case "leavePlan":
      return t("leavePlan");
    case "newRiders":
      return t("newRiders");
    case "contractFill":
      return t("contractFill");
    case "onLeaveNow":
      return t("onLeaveNow");
    case "turnover":
      return t("turnover");
    case "employeesDocs":
      return t("employeesDocs");
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

export function ClientsV2() {
  const t = useTranslations("pages.clientPortalV2");
  const tOps = useTranslations("pages.operationsDashboardV2");
  const [tab, setTab] = useState<Tab>("clients");
  const [configs, setConfigs] = useState<PortalConfig[]>([]);
  const [directory, setDirectory] = useState<PortalDirectoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newUser, setNewUser] = useState<{ project: string; name: string; email: string; role: PortalUserRole }>({
    project: "",
    name: "",
    email: "",
    role: "viewer",
  });

  const projectName = useCallback(
    (key: string) =>
      key === "americana" ? tOps("projectAmericana") : key === "unassigned" ? tOps("projectUnassigned") : tOps("projectKeeta"),
    [tOps],
  );

  const reload = useCallback(
    () =>
      Promise.all([fetchPortalConfigs(), fetchPortalDirectory()]).then(([portalResult, directoryResult]) => {
        setConfigs(portalResult.rows);
        setDirectory(directoryResult.rows);
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchPortalConfigs(), fetchPortalDirectory()]).then(([portalResult, directoryResult]) => {
      if (cancelled) return;
      setConfigs(portalResult.rows);
      setDirectory(directoryResult.rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () =>
      PROJECT_KEYS.map((key) => {
        const found = configs.find((config) => config.projectKey === key);
        const fallback = emptyPortalConfig(key);
        return { ...(found ?? { ...fallback, clientName: projectName(key) }), exists: Boolean(found) };
      }),
    [configs, projectName],
  );

  const ridersOf = (key: string) => directory.find((row) => row.projectKey === key)?.riders ?? 0;
  const activePortals = rows.filter((row) => row.exists && row.status === "active").length;
  const totalUsers = rows.reduce((sum, row) => sum + row.users.length, 0);
  const ridersVisible = rows.reduce((sum, row) => sum + (row.exists ? ridersOf(row.projectKey) : 0), 0);
  const allUsers = rows.flatMap((row) =>
    row.users.map((user) => ({ ...user, projectKey: row.projectKey, clientName: row.clientName })),
  );
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? rows.filter((row) => row.clientName.toLowerCase().includes(needle)) : rows;
  }, [rows, query]);

  const attention = useMemo(
    () =>
      rows
        .filter((row) => row.exists)
        .flatMap((row) => {
          const items: { key: string; text: string }[] = [];
          if (row.status !== "active") items.push({ key: `${row.projectKey}-draft`, text: t("attentionDraft", { project: row.clientName }) });
          if (row.users.length === 0) items.push({ key: `${row.projectKey}-users`, text: t("attentionNoUsers", { project: row.clientName }) });
          if (row.contractedHeadcount === 0) items.push({ key: `${row.projectKey}-headcount`, text: t("attentionNoHeadcount", { project: row.clientName }) });
          return items;
        }),
    [rows, t],
  );

  async function toggleSection(projectKey: string, key: PortalSectionKey, next: boolean) {
    const row = rows.find((item) => item.projectKey === projectKey);
    if (!row) return;
    const sections = { ...row.sections, [key]: next };
    setConfigs((current) => current.map((config) => (config.projectKey === projectKey ? { ...config, sections } : config)));
    const result = await savePortalSections({ projectKey, sections });
    if (result.error) {
      toast.error(t("saveFailed"));
      void reload();
      return;
    }
    toast.success(t("savedDraft"));
  }

  async function removeUser(projectKey: string, userId: string) {
    const row = configs.find((config) => config.projectKey === projectKey);
    if (!row) return;
    const users = row.users.filter((user) => user.id !== userId);
    setConfigs((current) => current.map((config) => (config.projectKey === projectKey ? { ...config, users } : config)));
    const result = await savePortalUsers({ projectKey, users });
    if (result.error) {
      toast.error(t("saveFailed"));
      void reload();
      return;
    }
    toast.success(t("userRemoved"));
  }

  async function addUser() {
    const email = newUser.email.trim().toLowerCase();
    if (!newUser.project || !newUser.name.trim() || !email) return;
    const row = configs.find((config) => config.projectKey === newUser.project);
    if (!row) return;
    if (row.users.some((user) => user.email.toLowerCase() === email)) {
      toast.error(t("userExists"));
      return;
    }
    setSaving(true);
    const users = [...row.users, { id: email, name: newUser.name.trim(), email, role: newUser.role }];
    const result = await savePortalUsers({ projectKey: newUser.project, users });
    setSaving(false);
    if (result.error) {
      toast.error(t("saveFailed"));
      return;
    }
    setConfigs((current) => current.map((config) => (config.projectKey === newUser.project ? { ...config, users } : config)));
    toast.success(t("userAdded"));
    setAddOpen(false);
    setNewUser({ project: "", name: "", email: "", role: "viewer" });
  }

  return (
    <div className="space-y-4">
      <AppBackButton fallbackHref="/client-portal-v2" />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--status-working-fg)] text-white">
            <Eye className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <nav className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <span>{t("breadcrumbApps")}</span>
              <span aria-hidden>›</span>
              <span className="text-[var(--text-secondary)]">{t("breadcrumbSelf")}</span>
            </nav>
            <h1 className="font-display text-[26px] font-bold leading-8 text-[var(--text-primary)]">{t("clientsTitle")}</h1>
            <p className="text-sm text-[var(--text-secondary)]">{t("clientsSubtitle")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="portal-secondary" className={HEAD_BTN} onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4" aria-hidden />
            {t("addUser")}
          </Button>
          <Button variant="portal" className={HEAD_BTN} render={<Link href="/client-portal-v2/new" />}>
            <Plus className="size-4" aria-hidden />
            {t("newClientPortal")}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border-default)] text-sm">
        {[
          { key: "clients" as const, label: `${t("tabClients")} ${rows.length}` },
          { key: "users" as const, label: `${t("tabUsers")} ${totalUsers}` },
          { key: "visibility" as const, label: t("tabVisibility") },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-current={tab === item.key ? "page" : undefined}
            className={cn(
              "cursor-pointer pb-2",
              tab === item.key
                ? "border-b-2 border-[var(--accent-rust)] font-medium text-[var(--accent-rust)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>


      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          layout="portal"
          portalAccent="green"
          label={t("kpiActivePortals")}
          value={activePortals}
          caption={t("captionPortalMix", {
            drafts: rows.filter((row) => row.exists && row.status !== "active").length,
            invites: rows.filter((row) => row.exists && row.users.length === 0).length,
          })}
        />
        <KpiCard layout="portal" portalAccent="ink" label={t("kpiClientUsers")} value={totalUsers} caption={t("captionSignedInWeek", { count: 0 })} />
        <KpiCard
          layout="portal"
          portalAccent="green"
          label={t("kpiRidersVisible")}
          value={ridersVisible}
          caption={t("captionRidersSplit", { keeta: ridersOf("keeta"), americana: ridersOf("americana") })}
        />
        <KpiCard layout="portal" portalAccent="ochre" label={t("kpiDocumentViews")} value="—" caption="—" />
      </div>

      {tab === "clients" ? (
        <div className="grid gap-3 xl:grid-cols-3">
          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display text-[16px] font-bold leading-6 text-[var(--text-primary)]">{t("clientsTableTitle")}</h2>
                <p className="text-[12px] text-[var(--text-secondary)]">{t("clientsTableSubtitle")}</p>
              </div>
              <span className="relative">
                <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-[var(--text-muted)]" aria-hidden />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchClients")}
                  className="h-9 w-56 border-[var(--border-default)] bg-[var(--surface-card)] ps-8"
                />
              </span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <Table className={TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TH}>{t("colClient")}</TableHead>
                    <TableHead className={`${TH} text-center`}>{t("colRiders")}</TableHead>
                    <TableHead className={`${TH} text-center`}>{t("colUsers")}</TableHead>
                    <TableHead className={TH}>{t("colContractFill")}</TableHead>
                    <TableHead className={TH}>{t("colStatus")}</TableHead>
                    <TableHead className={`${TH} text-end`}>{t("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>

                  {matched.map((row) => {
                    const riders = ridersOf(row.projectKey);
                    const fill = row.contractedHeadcount > 0 ? (riders / row.contractedHeadcount) * 100 : null;
                    const active = row.exists && row.status === "active";
                    return (
                      <TableRow key={row.projectKey}>
                        <TableCell>
                          <span className="flex items-center gap-2.5">
                            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--accent-rust)] text-[11px] font-semibold text-white">
                              {row.logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={row.logoUrl} alt="" className="size-9 object-cover" />
                              ) : (
                                portalInitials(row.clientName)
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-[var(--text-primary)]">{row.clientName}</span>
                              <span className="block truncate text-[11px] text-[var(--text-secondary)]">
                                {row.clientCode ? `${t("colClient")}: ${row.clientCode}` : projectName(row.projectKey)}
                              </span>
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{riders}</TableCell>
                        <TableCell className="text-center tabular-nums">{row.users.length}</TableCell>
                        <TableCell>
                          {fill == null ? (
                            "—"
                          ) : (
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                                <span className="block h-full rounded-full bg-[var(--status-working-fg)]" style={{ width: `${Math.min(100, fill)}%` }} />
                              </span>
                              <span className="tabular-nums text-[var(--text-secondary)]">{fill.toFixed(1)}%</span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                              active
                                ? "bg-[var(--status-working-bg)] text-[var(--status-working-fg)]"
                                : "bg-[var(--surface-subtle)] text-[var(--text-secondary)]",
                            )}
                          >
                            <span
                              className={cn("size-1.5 rounded-full", active ? "bg-[var(--status-working-fg)]" : "bg-[var(--status-neutral-fg)]")}
                              aria-hidden
                            />
                            {active ? t("statusActive") : t("statusDraft")}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center justify-end gap-1">
                            <Button variant="portal-secondary" className="h-8 cursor-pointer" render={<Link href={`/client-portal-v2/preview/${row.projectKey}`} />}>
                              <Eye className="size-4" aria-hidden />
                              {t("preview")}
                            </Button>
                            <Button
                              variant="portal-secondary"
                              className="size-8 cursor-pointer p-0"
                              aria-label={t("editPortal")}
                              title={t("editPortal")}
                              render={<Link href={`/client-portal-v2/new?project=${row.projectKey}`} />}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
            <h2 className="font-display text-[16px] font-bold leading-6 text-[var(--text-primary)]">{t("needsAttentionTitle")}</h2>
            {attention.length === 0 ? (
              <p className="mt-3 py-4 text-[13px] text-[var(--text-secondary)]">{t("nothingNeedsAttention")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {attention.slice(0, 5).map((item) => (
                  <li key={item.key} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--status-sick-fg)]" aria-hidden />
                    {item.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}


      {tab === "users" ? (
        <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-[16px] font-bold leading-6 text-[var(--text-primary)]">{t("tabUsers")}</h2>
              <p className="text-[12px] text-[var(--text-secondary)]">{t("usersSubtitle")}</p>
            </div>
            <Button variant="portal-secondary" className={HEAD_BTN} onClick={() => setAddOpen(true)}>
              <UserPlus className="size-4" aria-hidden />
              {t("addUser")}
            </Button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table className={TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH}>{t("userName")}</TableHead>
                  <TableHead className={TH}>{t("userEmail")}</TableHead>
                  <TableHead className={TH}>{t("userRole")}</TableHead>
                  <TableHead className={TH}>{t("colClient")}</TableHead>
                  <TableHead className={`${TH} text-end`}>{t("colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-[var(--text-secondary)]">
                      {t("noUsers")}
                    </TableCell>
                  </TableRow>
                ) : (
                  allUsers.map((user) => (
                    <TableRow key={`${user.projectKey}-${user.id}`}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <span className="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                          {user.role === "admin" ? t("roleAdmin") : t("roleViewer")}
                        </span>
                      </TableCell>
                      <TableCell>{user.clientName}</TableCell>
                      <TableCell className="text-end">
                        <button
                          type="button"
                          onClick={() => void removeUser(user.projectKey, user.id)}
                          aria-label={t("removeUser")}
                          title={t("removeUser")}
                          className="inline-grid size-8 cursor-pointer place-items-center rounded-lg border border-[var(--border-default)] text-[var(--status-absent-fg)] hover:bg-[var(--status-absent-bg)]"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}


      {tab === "visibility" ? (
        configs.length === 0 ? (
          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center">
            <p className="text-[13px] text-[var(--text-secondary)]">{t("noPortals")}</p>
            <Button variant="portal" className={`${HEAD_BTN} mt-3`} render={<Link href="/client-portal-v2/new" />}>
              <Plus className="size-4" aria-hidden />
              {t("newClientPortal")}
            </Button>
          </section>
        ) : (
          <div className="space-y-3">
            {rows
              .filter((row) => row.exists)
              .map((row) => (
                <section key={row.projectKey} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-display text-[15px] font-bold text-[var(--text-primary)]">{row.clientName}</h2>
                      <p className="text-[12px] text-[var(--text-secondary)]">
                        {projectName(row.projectKey)} · {t("summarySections")}: {PORTAL_SECTION_KEYS.filter((key) => row.sections[key]).length} /{" "}
                        {PORTAL_SECTION_KEYS.length}
                      </p>
                    </div>
                    <Button variant="portal-secondary" className={HEAD_BTN} render={<Link href={`/client-portal-v2/new?project=${row.projectKey}`} />}>
                      <Pencil className="size-4" aria-hidden />
                      {t("editPortal")}
                    </Button>
                  </div>
                  <div className="mt-2 divide-y divide-[var(--border-default)]">
                    {PORTAL_SECTION_KEYS.map((key) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-2.5">
                        <p className="text-[13px] text-[var(--text-primary)]">{sectionLabel(key, t)}</p>
                        <Switch
                          tone="portal"
                          checked={row.sections[key]}
                          onCheckedChange={(checked) => void toggleSection(row.projectKey, key, checked === true)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        )
      ) : null}


      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent closeOutside showCloseButton className="w-[min(520px,94vw)] max-w-none">
          <div className="space-y-3 px-5 pt-4">
            <label className="block space-y-1 text-xs">
              <span>{t("colClient")}</span>
              <Select value={newUser.project} onValueChange={(value) => setNewUser((current) => ({ ...current, project: value ?? "" }))}>
                <SelectTrigger className="h-9 border-[var(--border-default)] bg-[var(--surface-card)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rows
                    .filter((row) => row.exists)
                    .map((row) => (
                      <SelectItem key={row.projectKey} value={row.projectKey}>
                        {row.clientName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span>{t("userName")}</span>
              <Input
                className="h-9 border-[var(--border-default)] bg-[var(--surface-card)]"
                value={newUser.name}
                onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span>{t("userEmail")}</span>
              <Input
                className="h-9 border-[var(--border-default)] bg-[var(--surface-card)]"
                type="email"
                value={newUser.email}
                onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span>{t("userRole")}</span>
              <Select
                value={newUser.role}
                onValueChange={(value) => setNewUser((current) => ({ ...current, role: value === "viewer" ? "viewer" : "admin" }))}
              >
                <SelectTrigger className="h-9 border-[var(--border-default)] bg-[var(--surface-card)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                  <SelectItem value="viewer">{t("roleViewer")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className="px-5 pb-4">
            <AppModalFooter title={t("addUser")} subtitle={t("usersSubtitle")}>
              <Button variant="portal-neutral" className="h-9 cursor-pointer" onClick={() => setAddOpen(false)}>
                {t("cancel")}
              </Button>
              <Button
                variant="portal"
                className="h-9 cursor-pointer"
                disabled={saving || !newUser.project || !newUser.name.trim() || !newUser.email.trim()}
                onClick={() => void addUser()}
              >
                {t("addUser")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

