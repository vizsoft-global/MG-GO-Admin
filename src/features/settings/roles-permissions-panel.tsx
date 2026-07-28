"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  Bike,
  Copy,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCheck,
  Folder,
  Handshake,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Map as MapIcon,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  createCustomRole,
  deleteCustomRole,
  duplicateRole,
  updateRoleMeta,
  updateMultipleRolePermissions,
} from "@/features/settings/roles-actions";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import { isValidRoleSlug, slugifyRoleName } from "@/lib/auth/permission-catalog";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { AppFormSection } from "@/components/app";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { selectOptionsFrom } from "@/lib/select-items";

const ROLE_COL_CLASS = "w-[5.5rem] shrink-0";

export type PermissionRow = {
  slug: string;
  label: string;
  category: string;
};

const COLLAPSED_STORAGE_KEY = "dpd-roles-collapsed-categories:v2";

const CATEGORY_META: Record<string, { icon: LucideIcon; labelKey: string }> = {
  admin: { icon: Shield, labelKey: "categories.admin" },
  dashboard: { icon: LayoutDashboard, labelKey: "categories.dashboard" },
  drivers: { icon: Users, labelKey: "categories.drivers" },
  partners: { icon: Handshake, labelKey: "categories.partners" },
  restaurants: { icon: UtensilsCrossed, labelKey: "categories.restaurants" },
  vehicles: { icon: Bike, labelKey: "categories.vehicles" },
  deliveries: { icon: Package, labelKey: "categories.deliveries" },
  zones: { icon: MapIcon, labelKey: "categories.zones" },
  attendance: { icon: ClipboardCheck, labelKey: "categories.attendance" },
  requests: { icon: Inbox, labelKey: "categories.requests" },
  compliance: { icon: AlertTriangle, labelKey: "categories.compliance" },
  earnings: { icon: Wallet, labelKey: "categories.earnings" },
  notifications: { icon: Bell, labelKey: "categories.notifications" },
  support: { icon: LifeBuoy, labelKey: "categories.support" },
  settings: { icon: Settings, labelKey: "categories.settings" },
};

type RolesT = ReturnType<typeof useTranslations<"pages.settings.roles">>;

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function setsFromRolePermissions(roles: AdminRoleRow[]): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const role of roles) {
    if (role.isSuperAdmin) continue;
    out[role.id] = new Set(role.permissions);
  }
  return out;
}

function clonePermissionsByRole(
  source: Record<string, Set<string>>,
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const [id, perms] of Object.entries(source)) {
    out[id] = new Set(perms);
  }
  return out;
}

function loadCollapsedCategories(allCategories: string[]): Set<string> {
  if (typeof window === "undefined") {
    return new Set(allCategories);
  }
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      return new Set(parsed.filter((c) => allCategories.includes(c)));
    }
  } catch {
    /* ignore */
  }
  return new Set(allCategories);
}

function saveCollapsedCategories(collapsed: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(collapsed)));
  } catch {
    /* ignore */
  }
}

function categoryLabel(category: string, t: RolesT): string {
  const meta = CATEGORY_META[category];
  if (meta) return t(meta.labelKey as "categories.admin");
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function CategoryIcon({ category }: { category: string }) {
  const meta = CATEGORY_META[category];
  const Icon = meta?.icon ?? Folder;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

function RolesActionBar({
  roles,
  selectedColumnId,
  dirtyRoleIds,
  usageMap,
  permissionSearch,
  onSearchChange,
  searchPlaceholder,
  t,
  isPending,
  onSelect,
  onClone,
  onRename,
  onDelete,
  onExpandAll,
  onCollapseAll,
  onNew,
}: {
  roles: AdminRoleRow[];
  selectedColumnId: string;
  dirtyRoleIds: Set<string>;
  usageMap: Map<string, number>;
  permissionSearch: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  t: RolesT;
  isPending: boolean;
  onSelect: (id: string) => void;
  onClone: (role: AdminRoleRow) => void;
  onRename: (role: AdminRoleRow) => void;
  onDelete: (role: AdminRoleRow) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onNew: () => void;
}) {
  return (
    <div className="grid grid-cols-1 items-end gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-wrap items-end gap-2 lg:justify-self-start">
        {roles.map((role) => {
          const selected = role.id === selectedColumnId;
          const dirty = dirtyRoleIds.has(role.id);
          const userCount = usageMap.get(role.id) ?? 0;
          return (
            <div key={role.id} className="flex flex-col items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 cursor-pointer rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                title={t("duplicateRole")}
                aria-label={`${t("duplicateRole")}: ${role.name}`}
                onClick={() => onClone(role)}
                disabled={isPending}
              >
                <Copy className="size-3" />
              </Button>
              <div className="flex items-center">
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-background text-foreground hover:bg-muted/60",
                  )}
                  onClick={() => onSelect(role.id)}
                >
                  <span className="max-w-[10rem] truncate">{role.name}</span>
                  <span className={cn("opacity-70", selected && "text-primary-foreground/80")}>
                    · {t("usersAssigned", { count: userCount })}
                  </span>
                  {dirty ? (
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        selected ? "bg-primary-foreground" : "bg-amber-500",
                      )}
                      title={t("unsaved")}
                    />
                  ) : null}
                </button>
                {selected && !role.isSystem ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="ms-0.5 inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-primary-foreground hover:bg-primary-foreground/15"
                      aria-label={t("renameRole")}
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem className="cursor-pointer" onClick={() => onRename(role)}>
                        <Pencil className="me-2 size-3.5" />
                        {t("renameRole")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="cursor-pointer"
                        onClick={() => onDelete(role)}
                      >
                        <Trash2 className="me-2 size-3.5" />
                        {t("deleteRole")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <PermissionSearchBar
        value={permissionSearch}
        onChange={onSearchChange}
        placeholder={searchPlaceholder}
        className="mx-auto w-full max-w-[14rem] lg:justify-self-center"
      />

      <div className="flex items-center justify-end gap-1 lg:justify-self-end">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 cursor-pointer"
          title={t("expandAll")}
          aria-label={t("expandAll")}
          onClick={onExpandAll}
          disabled={isPending}
        >
          <ChevronsUpDown className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 cursor-pointer"
          title={t("collapseAll")}
          aria-label={t("collapseAll")}
          onClick={onCollapseAll}
          disabled={isPending}
        >
          <ChevronsDownUp className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 cursor-pointer gap-1 rounded-lg text-xs"
          onClick={onNew}
          disabled={isPending}
        >
          <Plus className="size-3.5" />
          {t("newRole")}
        </Button>
      </div>
    </div>
  );
}

function MatrixColumnHeader({
  roles,
  selectedColumnId,
  permissionsByRole,
  totalPermissions,
  t,
  onSelectRole,
}: {
  roles: AdminRoleRow[];
  selectedColumnId: string;
  permissionsByRole: Record<string, Set<string>>;
  totalPermissions: number;
  t: RolesT;
  onSelectRole: (id: string) => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-end gap-2 border-b border-border bg-card px-4 py-2">
            <div className="min-w-0 flex-1 pb-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("permissionColumn")}
        </p>
      </div>
      <div className="flex shrink-0 items-end gap-1">
        {roles.map((role) => {
          const selected = role.id === selectedColumnId;
          const enabled = permissionsByRole[role.id]?.size ?? 0;
          return (
            <button
              key={role.id}
              type="button"
              className={cn(
                ROLE_COL_CLASS,
                "cursor-pointer rounded-t-md px-1 pb-1.5 pt-1 text-center transition-colors",
                selected
                  ? "border-b-2 border-primary bg-primary/5 text-primary"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
              onClick={() => onSelectRole(role.id)}
            >
              <p className="truncate text-xs font-semibold">{role.name}</p>
              <p className="truncate text-[10px] tabular-nums opacity-80">
                {t("roleColumnSummary", {
                  checked: enabled,
                  total: totalPermissions,
                })}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PermissionSearchBar({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full", className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-md border-border/80 bg-background ps-8 text-xs"
      />
    </div>
  );
}

function CategorySectionBody({
  perms,
  editableRoles,
  selectedColumnId,
  selectedColumn,
  permissionsByRole,
  isPending,
  t,
  toggle,
  setCategoryForRole,
}: {
  perms: PermissionRow[];
  editableRoles: AdminRoleRow[];
  selectedColumnId: string;
  selectedColumn: AdminRoleRow | undefined;
  permissionsByRole: Record<string, Set<string>>;
  isPending: boolean;
  t: RolesT;
  toggle: (roleId: string, slug: string, on: boolean) => void;
  setCategoryForRole: (roleId: string, slugs: string[], enabled: boolean) => void;
}) {
  const slugs = perms.map((p) => p.slug);

  return (
    <div className="border-t border-border/60 bg-muted/10">
      {selectedColumn ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 cursor-pointer px-2 text-xs"
            disabled={isPending}
            onClick={() => setCategoryForRole(selectedColumn.id, slugs, true)}
          >
            {t("enableAllForRole", { role: selectedColumn.name })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 cursor-pointer px-2 text-xs"
            disabled={isPending}
            onClick={() => setCategoryForRole(selectedColumn.id, slugs, false)}
          >
            {t("clearAllForRole", { role: selectedColumn.name })}
          </Button>
        </div>
      ) : null}
      {perms.map((perm) => (
        <PermissionRowItem
          key={perm.slug}
          perm={perm}
          editableRoles={editableRoles}
          selectedColumnId={selectedColumnId}
          permissionsByRole={permissionsByRole}
          isPending={isPending}
          toggle={toggle}
        />
      ))}
    </div>
  );
}

function PermissionRowItem({
  perm,
  editableRoles,
  selectedColumnId,
  permissionsByRole,
  isPending,
  toggle,
}: {
  perm: PermissionRow;
  editableRoles: AdminRoleRow[];
  selectedColumnId: string;
  permissionsByRole: Record<string, Set<string>>;
  isPending: boolean;
  toggle: (roleId: string, slug: string, on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/30 px-4 py-1.5 last:border-b-0">
      <p className="min-w-0 flex-1 text-sm text-foreground">{perm.label}</p>
      <div className="flex shrink-0 items-center gap-1">
        {editableRoles.map((role) => {
          const checked = permissionsByRole[role.id]?.has(perm.slug) ?? false;
          const highlighted = role.id === selectedColumnId;
          return (
            <div
              key={role.id}
              className={cn(
                ROLE_COL_CLASS,
                "flex items-center justify-center py-0.5",
                highlighted && "bg-primary/8",
              )}
            >
              <Switch
                checked={checked}
                disabled={isPending}
                onCheckedChange={(on) => toggle(role.id, perm.slug, on)}
                className="cursor-pointer scale-90"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RolesPermissionsPanel({
  roles,
  permissions,
  usageCounts,
}: {
  roles: AdminRoleRow[];
  permissions: PermissionRow[];
  usageCounts: { roleId: string; userCount: number }[];
}) {
  const t = useTranslations("pages.settings.roles");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const editableRoles = useMemo(
    () => roles.filter((r) => !r.isSuperAdmin),
    [roles],
  );

  const roleTemplateItems = useMemo(
    () => selectOptionsFrom(editableRoles, (r) => r.id, (r) => r.name),
    [editableRoles],
  );

  const usageMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of usageCounts) m.set(u.roleId, u.userCount);
    return m;
  }, [usageCounts]);

  const savedByRole = useMemo(() => setsFromRolePermissions(roles), [roles]);

  const [permissionsByRole, setPermissionsByRole] = useState<Record<string, Set<string>>>(
    () => clonePermissionsByRole(savedByRole),
  );

  const [selectedColumnId, setSelectedColumnId] = useState(
    () => editableRoles[0]?.id ?? "",
  );

  const [permissionSearch, setPermissionSearch] = useState("");

  const byCategory = useMemo(() => {
    return permissions.reduce<Record<string, PermissionRow[]>>((acc, p) => {
      const list = acc[p.category] ?? [];
      list.push(p);
      acc[p.category] = list;
      return acc;
    }, {});
  }, [permissions]);

  const sortedCategories = useMemo(
    () => Object.keys(byCategory).sort((a, b) => a.localeCompare(b)),
    [byCategory],
  );

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => loadCollapsedCategories(sortedCategories),
  );

  useEffect(() => {
    setPermissionsByRole(clonePermissionsByRole(savedByRole));
  }, [savedByRole]);

  const persistCollapsed = useCallback((next: Set<string>) => {
    setCollapsedCategories(next);
    saveCollapsedCategories(next);
  }, []);

  const expandAll = useCallback(() => {
    persistCollapsed(new Set());
  }, [persistCollapsed]);

  const collapseAll = useCallback(() => {
    persistCollapsed(new Set(sortedCategories));
  }, [persistCollapsed, sortedCategories]);

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      saveCollapsedCategories(next);
      return next;
    });
  }, []);

  const dirtyRoleIds = useMemo(() => {
    const dirty = new Set<string>();
    for (const role of editableRoles) {
      const current = permissionsByRole[role.id];
      const saved = savedByRole[role.id];
      if (!current || !saved) continue;
      if (!setsEqual(current, saved)) dirty.add(role.id);
    }
    return dirty;
  }, [editableRoles, permissionsByRole, savedByRole]);

  const hasDirty = dirtyRoleIds.size > 0;

  const searchQuery = permissionSearch.trim().toLowerCase();

  const filteredByCategory = useMemo(() => {
    if (!searchQuery) return byCategory;
    const out: Record<string, PermissionRow[]> = {};
    for (const [category, perms] of Object.entries(byCategory)) {
      const filtered = perms.filter(
        (p) =>
          p.label.toLowerCase().includes(searchQuery) ||
          p.slug.toLowerCase().includes(searchQuery),
      );
      if (filtered.length > 0) out[category] = filtered;
    }
    return out;
  }, [byCategory, searchQuery]);

  const visibleCategories = useMemo(
    () =>
      sortedCategories.filter((c) => (filteredByCategory[c]?.length ?? 0) > 0),
    [sortedCategories, filteredByCategory],
  );

  const toggle = useCallback((roleId: string, slug: string, on: boolean) => {
    setPermissionsByRole((prev) => {
      const next = { ...prev };
      const set = new Set(next[roleId] ?? []);
      if (on) set.add(slug);
      else set.delete(slug);
      next[roleId] = set;
      return next;
    });
  }, []);

  const setCategoryForRole = useCallback(
    (roleId: string, slugs: string[], enabled: boolean) => {
      setPermissionsByRole((prev) => {
        const next = { ...prev };
        const set = new Set(next[roleId] ?? []);
        for (const slug of slugs) {
          if (enabled) set.add(slug);
          else set.delete(slug);
        }
        next[roleId] = set;
        return next;
      });
    },
    [],
  );

  const discardAll = useCallback(() => {
    setPermissionsByRole(clonePermissionsByRole(savedByRole));
  }, [savedByRole]);

  const saveAll = useCallback(() => {
    const updates = Array.from(dirtyRoleIds).map((roleId) => ({
      roleId,
      permissionSlugs: Array.from(permissionsByRole[roleId] ?? []),
    }));
    startTransition(async () => {
      const result = await updateMultipleRolePermissions(updates);
      if (result.error) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  }, [dirtyRoleIds, permissionsByRole, router, t]);

  const selectedColumn =
    editableRoles.find((r) => r.id === selectedColumnId) ?? editableRoles[0];

  useEffect(() => {
    if (dirtyRoleIds.size === 0) return;
    setCollapsedCategories((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const roleId of dirtyRoleIds) {
        const current = permissionsByRole[roleId];
        const saved = savedByRole[roleId];
        if (!current || !saved) continue;
        for (const perm of permissions) {
          const was = saved.has(perm.slug);
          const now = current.has(perm.slug);
          if (was !== now && next.has(perm.category)) {
            next.delete(perm.category);
            changed = true;
          }
        }
      }
      if (changed) saveCollapsedCategories(next);
      return changed ? next : prev;
    });
  }, [dirtyRoleIds, permissions, permissionsByRole, savedByRole]);

  const [newOpen, setNewOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formTemplateId, setFormTemplateId] = useState("");

  function openNewDialog() {
    setFormName("");
    setFormSlug("");
    setFormTemplateId(selectedColumnId || editableRoles[0]?.id || "");
    setNewOpen(true);
  }

  function openDuplicateDialog(role: AdminRoleRow) {
    setFormName(`${role.name} Copy`);
    setFormSlug(slugifyRoleName(`${role.slug}_copy`));
    setSelectedColumnId(role.id);
    setDupOpen(true);
  }

  function openRenameDialog(role: AdminRoleRow) {
    setFormName(role.name);
    setSelectedColumnId(role.id);
    setRenameOpen(true);
  }

  function handleNameChangeForSlug(name: string) {
    setFormName(name);
    setFormSlug(slugifyRoleName(name));
  }

  function mapCreateError(code?: string): string {
    switch (code) {
      case "invalid_name":
        return t("errors.invalidName");
      case "invalid_slug":
        return t("errors.invalidSlug");
      case "slug_exists":
        return t("errors.slugExists");
      case "slug_reserved":
        return t("errors.slugReserved");
      default:
        return t("errors.createFailed");
    }
  }

  if (editableRoles.length === 0) {
    return (
      <AppFormSection title={t("title")} description={t("subtitle")}>
        <p className="text-sm text-muted-foreground">{t("selectRole")}</p>
      </AppFormSection>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <RolesActionBar
          roles={editableRoles}
          selectedColumnId={selectedColumnId}
          dirtyRoleIds={dirtyRoleIds}
          usageMap={usageMap}
          permissionSearch={permissionSearch}
          onSearchChange={setPermissionSearch}
          searchPlaceholder={t("searchPermission")}
          t={t}
          isPending={isPending}
          onSelect={setSelectedColumnId}
          onClone={openDuplicateDialog}
          onRename={openRenameDialog}
          onDelete={(role) => {
            setSelectedColumnId(role.id);
            setDeleteOpen(true);
          }}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onNew={openNewDialog}
        />

        <Card className="w-full min-w-0 overflow-hidden rounded-xl border-border shadow-sm">
          <CardContent className="flex flex-col p-0">
            <MatrixColumnHeader
              roles={editableRoles}
              selectedColumnId={selectedColumnId}
              permissionsByRole={permissionsByRole}
              totalPermissions={permissions.length}
              t={t}
              onSelectRole={setSelectedColumnId}
            />

            <div className="max-h-[min(60vh,640px)] overflow-y-auto">
            {visibleCategories.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("noSearchResults")}
              </p>
            ) : (
              visibleCategories.map((category) => {
                const perms = filteredByCategory[category] ?? [];
                const isCollapsed = collapsedCategories.has(category);
                const selectedPerms = selectedColumn
                  ? permissionsByRole[selectedColumn.id]
                  : undefined;
                const checkedCount = perms.filter((p) =>
                  selectedPerms?.has(p.slug),
                ).length;

                return (
                  <section
                    key={category}
                    className="border-b border-border last:border-b-0"
                  >
                    <div className="flex items-center gap-2 px-4 py-2.5">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-start hover:opacity-80"
                        onClick={() => toggleCategory(category)}
                        aria-expanded={!isCollapsed}
                      >
                        <CategoryIcon category={category} />
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            {categoryLabel(category, t)}
                          </p>
                          {selectedColumn ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                              {t("categoryProgress", {
                                checked: checkedCount,
                                total: perms.length,
                              })}
                            </span>
                          ) : null}
                        </div>
                        <ChevronDown
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isCollapsed && "-rotate-90",
                          )}
                        />
                      </button>
                      </div>

                    {!isCollapsed ? (
                      <CategorySectionBody
                        perms={perms}
                        editableRoles={editableRoles}
                        selectedColumnId={selectedColumnId}
                        selectedColumn={selectedColumn}
                        permissionsByRole={permissionsByRole}
                        isPending={isPending}
                        t={t}
                        toggle={toggle}
                        setCategoryForRole={setCategoryForRole}
                      />
                    ) : null}
                  </section>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {hasDirty ? (
              <span className="me-auto text-xs text-amber-600 dark:text-amber-400">
                {t("unsaved")}
              </span>
            ) : (
              <span className="me-auto" />
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 cursor-pointer text-xs"
              disabled={isPending || !hasDirty}
              onClick={discardAll}
            >
              {t("discardAll")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 cursor-pointer rounded-lg text-xs"
              disabled={isPending || !hasDirty}
              onClick={saveAll}
            >
              {isPending ? t("saving") : t("saveAll")}
            </Button>
          </div>
        </CardContent>
        </Card>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialogs.newTitle")}</DialogTitle>
            <DialogDescription>{t("dialogs.newDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-role-name">{t("roleName")}</Label>
              <Input
                id="new-role-name"
                value={formName}
                onChange={(e) => handleNameChangeForSlug(e.target.value)}
                className="rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-slug">{t("roleSlug")}</Label>
              <Input
                id="role-slug"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
                className="rounded-lg font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("startFromRole")}</Label>
              <Select
                items={roleTemplateItems}
                value={formTemplateId}
                onValueChange={(v) => setFormTemplateId(v ?? "")}
              >
                <SelectTrigger className="w-full cursor-pointer rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {editableRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id} label={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => setNewOpen(false)}
            >
              {t("discard")}
            </Button>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={
                isPending || !formName.trim() || !isValidRoleSlug(formSlug)
              }
              onClick={() => {
                const template = editableRoles.find((r) => r.id === formTemplateId);
                const templatePerms = template
                  ? Array.from(permissionsByRole[template.id] ?? [])
                  : [];
                startTransition(async () => {
                  const result = await createCustomRole(
                    formName,
                    formSlug,
                    templatePerms,
                  );
                  if (result.error) {
                    toast.error(mapCreateError(result.error));
                    return;
                  }
                  toast.success(t("saved"));
                  setNewOpen(false);
                  if (result.roleId) setSelectedColumnId(result.roleId);
                  router.refresh();
                });
              }}
            >
              {isPending ? t("creating") : t("createRole")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialogs.duplicateTitle")}</DialogTitle>
            <DialogDescription>{t("dialogs.duplicateDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="dup-role-name">{t("roleName")}</Label>
              <Input
                id="dup-role-name"
                value={formName}
                onChange={(e) => handleNameChangeForSlug(e.target.value)}
                className="rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dup-role-slug">{t("roleSlug")}</Label>
              <Input
                id="dup-role-slug"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
                className="rounded-lg font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => setDupOpen(false)}
            >
              {t("discard")}
            </Button>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={
                isPending ||
                !selectedColumn ||
                !formName.trim() ||
                !isValidRoleSlug(formSlug)
              }
              onClick={() => {
                if (!selectedColumn) return;
                startTransition(async () => {
                  const result = await duplicateRole(
                    selectedColumn.id,
                    formName,
                    formSlug,
                  );
                  if (result.error) {
                    toast.error(mapCreateError(result.error));
                    return;
                  }
                  toast.success(t("saved"));
                  setDupOpen(false);
                  if (result.roleId) setSelectedColumnId(result.roleId);
                  router.refresh();
                });
              }}
            >
              {isPending ? t("duplicating") : t("duplicate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("dialogs.renameTitle")}</DialogTitle>
            <DialogDescription>{t("dialogs.renameDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="rename-role">{t("roleName")}</Label>
            <Input
              id="rename-role"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="rounded-lg"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => setRenameOpen(false)}
            >
              {t("discard")}
            </Button>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={
                isPending ||
                !selectedColumn ||
                selectedColumn.isSystem ||
                !formName.trim()
              }
              onClick={() => {
                if (!selectedColumn || selectedColumn.isSystem) return;
                startTransition(async () => {
                  const result = await updateRoleMeta(selectedColumn.id, formName);
                  if (result.error) {
                    toast.error(t("errors.renameFailed"));
                    return;
                  }
                  toast.success(t("saved"));
                  setRenameOpen(false);
                  router.refresh();
                });
              }}
            >
              {isPending ? t("renaming") : t("rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedColumn && !selectedColumn.isSystem ? (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          itemTitle={t("deleteConfirmTitle")}
          itemName={selectedColumn.name}
          confirmText={t("deleteConfirmText")}
          warning={
            (usageMap.get(selectedColumn.id) ?? 0) > 0
              ? t("errors.roleInUse")
              : undefined
          }
          onConfirm={() => {
            startTransition(async () => {
              const result = await deleteCustomRole(selectedColumn.id);
              if (result.error === "role_in_use") {
                toast.error(t("errors.roleInUse"));
                return;
              }
              if (result.error) {
                toast.error(t("errors.deleteFailed"));
                return;
              }
              toast.success(t("saved"));
              setDeleteOpen(false);
              const next = editableRoles.find((r) => r.id !== selectedColumn.id);
              if (next) setSelectedColumnId(next.id);
              router.refresh();
            });
          }}
          isPending={isPending}
        />
      ) : null}
    </>
  );
}
