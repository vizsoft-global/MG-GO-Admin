"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink, Search } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader, TABLE_HEAD_CLASS } from "@/components/app";
import { SegmentOption } from "@/components/app/toggle-chip";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { selectOptionsFrom } from "@/lib/select-items";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import { CATALOG_SLUGS } from "@/lib/auth/permission-catalog";
import {
  isStaffMatrixSlug,
  managerDowngradeSeedTicks,
  type StaffAccessKind,
} from "@/lib/auth/staff-access";
import {
  copyRoleTemplateTicks,
  saveStaffAccess,
  type StaffAccessDetail,
  type StaffAccessListRow,
} from "@/features/settings/staff-access-actions";

type PermissionRow = { slug: string; label: string; category: string };

export function StaffAccessListShell({
  rows,
  loadError,
}: {
  rows: StaffAccessListRow[];
  loadError?: string;
}) {
  const t = useTranslations("pages.settings.staffAccess");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.fullName, row.email, row.roleName, row.accessKind]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <AppListCard
        toolbar={
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("search")}
            className="h-9 max-w-xs"
          />
        }
      >
        {loadError ? (
          <p className="px-4 py-8 text-center text-sm text-destructive">{t("errors.loadFailed")}</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("name")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("email")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("kind")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("roleTemplate")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("ticks")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.fullName ?? "—"}</TableCell>
                  <TableCell>{row.email ?? "—"}</TableCell>
                  <TableCell>{row.isSuperAdmin ? t("kindManager") : kindLabel(row.accessKind, t)}</TableCell>
                  <TableCell>{row.roleName ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    {row.isSuperAdmin || row.accessKind === "manager" ? t("fullAccess") : row.tickCount}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 text-primary hover:bg-primary/10"
                      render={<Link href={`/settings/staff-access/${row.id}`} />}
                    >
                      <ExternalLink className="me-1.5 size-3.5" />
                      {t("edit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AppListCard>
    </AppPage>
  );
}

function kindLabel(
  kind: StaffAccessKind | null,
  t: ReturnType<typeof useTranslations<"pages.settings.staffAccess">>,
) {
  if (kind === "manager") return t("kindManager");
  if (kind === "user") return t("kindUser");
  return t("kindUnknown");
}

export function StaffAccessDetailShell({
  detail,
  permissions,
  roles,
}: {
  detail: StaffAccessDetail;
  permissions: PermissionRow[];
  roles: AdminRoleRow[];
}) {
  const t = useTranslations("pages.settings.staffAccess");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<StaffAccessKind>(detail.accessKind);
  const [ticks, setTicks] = useState<Set<string>>(() => new Set(detail.slugs));
  const [search, setSearch] = useState("");
  const [downgradeOpen, setDowngradeOpen] = useState(false);
  const [copyRoleId, setCopyRoleId] = useState(detail.roleId ?? roles[0]?.id ?? "");
  const roleItems = useMemo(
    () => selectOptionsFrom(roles, (role) => role.id, (role) => role.name),
    [roles],
  );

  const matrixPermissions = useMemo(
    () => permissions.filter((row) => isStaffMatrixSlug(row.slug)),
    [permissions],
  );

  const byCategory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<string, PermissionRow[]>();
    for (const row of matrixPermissions) {
      if (
        q &&
        !row.label.toLowerCase().includes(q) &&
        !row.slug.toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = groups.get(row.category) ?? [];
      list.push(row);
      groups.set(row.category, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [matrixPermissions, search]);

  const applyKind = (next: StaffAccessKind) => {
    if (kind === "manager" && next === "user") {
      setDowngradeOpen(true);
      return;
    }
    setKind(next);
  };

  const confirmDowngrade = () => {
    setKind("user");
    setTicks(managerDowngradeSeedTicks(CATALOG_SLUGS));
  };

  const toggle = (slug: string, on: boolean) => {
    setTicks((prev) => {
      const next = new Set(prev);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveStaffAccess({
        userId: detail.id,
        accessKind: kind,
        slugs: [...ticks],
      });
      if (result.error) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  };

  const copyRole = () => {
    if (!copyRoleId) return;
    startTransition(async () => {
      const result = await copyRoleTemplateTicks(copyRoleId);
      if (result.error || !result.slugs) {
        toast.error(t("errors.copyFailed"));
        return;
      }
      setTicks(new Set(result.slugs));
      toast.success(t("templateCopied"));
    });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={detail.fullName ?? detail.email ?? t("title")}
        description={detail.email ?? undefined}
        breadcrumbs={[
          { label: t("title"), href: "/settings/staff-access" },
          { label: detail.fullName ?? t("edit") },
        ]}
        actions={
          <Button type="button" className="h-9" disabled={isPending} onClick={save}>
            {isPending ? t("saving") : t("save")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SegmentOption selected={kind === "manager"} onClick={() => applyKind("manager")}>
          {t("kindManager")}
        </SegmentOption>
        <SegmentOption selected={kind === "user"} onClick={() => applyKind("user")}>
          {t("kindUser")}
        </SegmentOption>
        <p className="text-[10px] text-muted-foreground">{t("kindHint")}</p>
      </div>

      {kind === "manager" ? (
        <p className="text-sm text-muted-foreground">{t("managerNote")}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPermission")}
                className="h-9 ps-8"
              />
            </div>
            <Select
              items={roleItems}
              value={copyRoleId}
              onValueChange={(value) => setCopyRoleId(value ?? "")}
            >
              <SelectTrigger className="h-9 w-[200px] cursor-pointer">
                <SelectValue placeholder={t("copyFromRole")} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id} label={role.name}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="h-9" disabled={isPending} onClick={copyRole}>
              {t("applyTemplate")}
            </Button>
          </div>

          {byCategory.map(([category, rows]) => (
            <div key={category} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((row) => (
                  <label key={row.slug} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={ticks.has(row.slug)}
                      onCheckedChange={(on) => toggle(row.slug, on)}
                      className="scale-90 cursor-pointer"
                    />
                    <span>
                      {row.label}
                      <span className="ms-1 text-[10px] text-muted-foreground">{row.slug}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <SimpleConfirmDialog
        open={downgradeOpen}
        onOpenChange={setDowngradeOpen}
        title={t("downgradeTitle")}
        description={t("downgradeDescription")}
        confirmLabel={t("downgradeConfirm")}
        onConfirm={confirmDowngrade}
      />
    </AppPage>
  );
}
