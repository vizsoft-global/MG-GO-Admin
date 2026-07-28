"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRight,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  Loader2,
  PanelRight,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconPicker } from "@/components/menu-editor/icon-picker";
import {
  copyMenuConfig,
  getMenuConfig,
  resetMenuConfig,
  saveMenuConfig,
  type MenuNode,
} from "@/services/menu-config-service";
import { mergeMenu } from "@/lib/menu/menu-merge";
import { MENU_REGISTRY } from "@/lib/menu/menu-registry";
import { cn } from "@/lib/utils";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import {
  MenuEditorDndProvider,
  SortableDragHandle,
  SortableShell,
  orderEntryId,
  reorderById,
  rowItemId,
  type SortableHandleProps,
} from "@/features/menu-editor/menu-editor-sortable";
import { arrayMove } from "@dnd-kit/sortable";

const NONE_GROUP = "__none__";

function humanizeRole(slug: string): string {
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function roleLabel(roles: AdminRoleRow[], slug: string): string {
  return roles.find((r) => r.slug === slug)?.name ?? humanizeRole(slug);
}

function notifyMenuConfigUpdated(targetRole: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`sidebar-menu-cache:v3:${targetRole}`);
    window.dispatchEvent(
      new CustomEvent("menu-config-updated", { detail: { role: targetRole } }),
    );
  } catch {
    /* ignore */
  }
}

type FlatRow = {
  itemId: string;
  label: string;
  icon: string;
  hidden: boolean;
  groupId: string;
};

type OrderEntry = { kind: "group" | "item"; id: string };

function parseOrderSortId(id: string): OrderEntry | null {
  const match = /^order:(group|item):(.+)$/.exec(id);
  if (!match) return null;
  return { kind: match[1] as "group" | "item", id: match[2]! };
}

function flattenTree(tree: MenuNode[]): {
  rows: FlatRow[];
  groups: MenuNode[];
  order: OrderEntry[];
} {
  const rows: FlatRow[] = [];
  const groups: MenuNode[] = [];
  const order: OrderEntry[] = [];
  for (const n of tree) {
    if (n.type === "group") {
      groups.push(n);
      order.push({ kind: "group", id: n.id });
      for (const child of n.children || []) {
        if (child.type === "item") {
          rows.push({
            itemId: child.id,
            label: child.label,
            icon: child.icon,
            hidden: !!child.hidden,
            groupId: n.id,
          });
        }
      }
    } else if (n.type === "item") {
      order.push({ kind: "item", id: n.id });
      rows.push({
        itemId: n.id,
        label: n.label,
        icon: n.icon,
        hidden: !!n.hidden,
        groupId: NONE_GROUP,
      });
    }
  }
  return { rows, groups, order };
}

function rebuildTree(
  rows: FlatRow[],
  groups: MenuNode[],
  order: OrderEntry[],
): MenuNode[] {
  const rowByItem = new Map<string, FlatRow>();
  for (const r of rows) rowByItem.set(r.itemId, r);
  const groupById = new Map<string, MenuNode>();
  for (const g of groups) groupById.set(g.id, g);
  const rowsByGroup = new Map<string, FlatRow[]>();
  for (const r of rows) {
    if (r.groupId === NONE_GROUP) continue;
    if (!rowsByGroup.has(r.groupId)) rowsByGroup.set(r.groupId, []);
    rowsByGroup.get(r.groupId)!.push(r);
  }
  const result: MenuNode[] = [];
  const seenItems = new Set<string>();
  for (const entry of order) {
    if (entry.kind === "item") {
      const r = rowByItem.get(entry.id);
      if (r && r.groupId === NONE_GROUP) {
        result.push({
          id: r.itemId,
          type: "item",
          label: r.label,
          icon: r.icon,
          hidden: r.hidden,
        });
        seenItems.add(r.itemId);
      }
    } else {
      const g = groupById.get(entry.id);
      if (!g) continue;
      const children = (rowsByGroup.get(g.id) || []).map((r) => ({
        id: r.itemId,
        type: "item" as const,
        label: r.label,
        icon: r.icon,
        hidden: r.hidden,
      }));
      if (children.length > 0 || g.id.startsWith("group-custom-")) {
        result.push({ ...g, children });
      }
    }
  }
  for (const r of rows) {
    if (r.groupId === NONE_GROUP && !seenItems.has(r.itemId)) {
      result.push({
        id: r.itemId,
        type: "item",
        label: r.label,
        icon: r.icon,
        hidden: r.hidden,
      });
    }
  }
  return result;
}

export function MenuEditorPanel({ roles }: { roles: AdminRoleRow[] }) {
  const t = useTranslations("pages.settings.menuEditor");
  const [role, setRole] = useState("");
  const [rows, setRows] = useState<FlatRow[]>([]);
  const [groups, setGroups] = useState<MenuNode[]>([]);
  const [order, setOrder] = useState<OrderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [copyFromRole, setCopyFromRole] = useState("");
  const [copyToRole, setCopyToRole] = useState("");

  useEffect(() => {
    if (roles.length > 0 && !role) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bootstrap default role tab
      setRole(roles[0]!.slug);
    }
  }, [roles, role]);

  useEffect(() => {
    if (role) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep copy target in sync with active tab
      setCopyToRole(role);
    }
  }, [role]);

  useEffect(() => {
    if (roles.length === 0 || copyFromRole) return;
    const other = roles.find((r) => r.slug !== role);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- default copy source to a different role
    setCopyFromRole(other?.slug ?? roles[0]!.slug);
  }, [roles, role, copyFromRole]);

  const applyMenuTree = useCallback((tree: MenuNode[], markDirty: boolean) => {
    const flat = flattenTree(tree);
    setRows(flat.rows);
    setGroups(flat.groups);
    setOrder(flat.order);
    setDirty(markDirty);
  }, []);

  const load = useCallback(async (r: string) => {
    if (!r) return;
    setLoading(true);
    try {
      const cfg = await getMenuConfig(r);
      const { tree } = mergeMenu(cfg);
      applyMenuTree(tree, false);
    } finally {
      setLoading(false);
    }
  }, [applyMenuTree]);

  useEffect(() => {
    if (role) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reload editor when role tab changes
      void load(role);
    }
  }, [role, load]);

  const updateRow = (itemId: string, patch: Partial<FlatRow>) => {
    setRows((rs) => {
      const row = rs.find((r) => r.itemId === itemId);
      if (!row) return rs;
      const nextGroupId = patch.groupId ?? row.groupId;
      if (patch.groupId !== undefined && patch.groupId !== row.groupId) {
        setOrder((o) => {
          const has = o.some((e) => e.kind === "item" && e.id === itemId);
          if (nextGroupId === NONE_GROUP && !has) {
            return [...o, { kind: "item", id: itemId }];
          }
          if (nextGroupId !== NONE_GROUP && has) {
            return o.filter((e) => !(e.kind === "item" && e.id === itemId));
          }
          return o;
        });
      }
      return rs.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r));
    });
    setDirty(true);
  };

  const handleOrderDragEnd = useCallback((activeId: string, overId: string) => {
    const activeEntry = parseOrderSortId(activeId);
    const overEntry = parseOrderSortId(overId);
    if (!activeEntry || !overEntry) return;
    setOrder((o) => {
      const oldIndex = o.findIndex(
        (e) => e.kind === activeEntry.kind && e.id === activeEntry.id,
      );
      const newIndex = o.findIndex(
        (e) => e.kind === overEntry.kind && e.id === overEntry.id,
      );
      if (oldIndex < 0 || newIndex < 0) return o;
      return arrayMove(o, oldIndex, newIndex);
    });
    setDirty(true);
  }, []);

  const handleRowDragEnd = useCallback((activeId: string, overId: string) => {
    const activeItemId = activeId.replace(/^row:/, "");
    const overItemId = overId.replace(/^row:/, "");
    const activeRow = rows.find((r) => r.itemId === activeItemId);
    const overRow = rows.find((r) => r.itemId === overItemId);
    if (!activeRow || !overRow || activeRow.groupId !== overRow.groupId) return;
    if (activeRow.groupId === NONE_GROUP) return;

    setRows((rs) => {
      const sameGroup = rs.filter((r) => r.groupId === activeRow.groupId);
      const reordered = reorderById(
        sameGroup,
        activeItemId,
        overItemId,
        (r) => r.itemId,
      );
      let gc = 0;
      return rs.map((r) =>
        r.groupId === activeRow.groupId ? reordered[gc++]! : r,
      );
    });
    setDirty(true);
  }, [rows]);

  const addGroup = () => {
    const id = `group-custom-${Date.now()}`;
    setGroups((g) => [
      ...g,
      { id, type: "group", label: t("newGroupLabel"), icon: "Folder", children: [] },
    ]);
    setOrder((o) => [...o, { kind: "group", id }]);
    setDirty(true);
  };

  const deleteGroup = (gid: string) => {
    if (!gid.startsWith("group-custom-")) return;
    setRows((rs) =>
      rs.map((r) => {
        if (r.groupId !== gid) return r;
        setOrder((o) => {
          const has = o.some((e) => e.kind === "item" && e.id === r.itemId);
          return has ? o : [...o, { kind: "item", id: r.itemId }];
        });
        return { ...r, groupId: NONE_GROUP };
      }),
    );
    setGroups((g) => g.filter((x) => x.id !== gid));
    setOrder((o) => o.filter((e) => !(e.kind === "group" && e.id === gid)));
    setDirty(true);
  };

  const renameGroup = (gid: string, label: string) => {
    setGroups((g) => g.map((x) => (x.id === gid ? { ...x, label } : x)));
    setDirty(true);
  };

  const resetRow = (itemId: string) => {
    const reg = MENU_REGISTRY.find((r) => r.id === itemId);
    if (!reg) return;
    updateRow(itemId, {
      label: reg.defaultLabel,
      icon: reg.defaultIcon,
      hidden: false,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const tree = rebuildTree(rows, groups, order);
      await saveMenuConfig(role, tree);
      setDirty(false);
      notifyMenuConfigUpdated(role);
      toast.success(t("saved"), {
        description: t("savedDesc", { role: roleLabel(roles, role) }),
      });
    } catch (err) {
      toast.error(t("saveFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm(t("resetConfirm", { role: roleLabel(roles, role) }))) return;
    await resetMenuConfig(role);
    await load(role);
    toast.success(t("resetDone"));
  };

  const handleCopySettings = async () => {
    if (!copyFromRole || !copyToRole || copyFromRole === copyToRole) return;
    if (
      !confirm(
        t("copyConfirm", {
          from: roleLabel(roles, copyFromRole),
          to: roleLabel(roles, copyToRole),
        }),
      )
    ) {
      return;
    }

    setCopying(true);
    try {
      await copyMenuConfig(copyFromRole, copyToRole);
      notifyMenuConfigUpdated(copyToRole);
      if (copyToRole === role) {
        await load(role);
      }
      toast.success(t("copyDone"), {
        description: t("copyDoneDesc", {
          from: roleLabel(roles, copyFromRole),
          to: roleLabel(roles, copyToRole),
        }),
      });
    } catch (err) {
      toast.error(t("copyFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCopying(false);
    }
  };

  const handleLoadFromRole = async () => {
    if (!copyFromRole || copyFromRole === role) return;
    if (dirty && !confirm(t("loadFromDiscard"))) return;

    setLoading(true);
    try {
      const cfg = await getMenuConfig(copyFromRole);
      const { tree } = mergeMenu(cfg);
      applyMenuTree(tree, true);
      toast.success(t("loadedFrom"), {
        description: t("loadedFromDesc", { role: roleLabel(roles, copyFromRole) }),
      });
    } catch (err) {
      toast.error(t("copyFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  const copyRolesDisabled =
    !copyFromRole || !copyToRole || copyFromRole === copyToRole;

  const toggleGroupMode = (gid: string) => {
    setGroups((gs) =>
      gs.map((g) =>
        g.id === gid
          ? { ...g, displayMode: g.displayMode === "panel" ? "inline" : "panel" }
          : g,
      ),
    );
    setDirty(true);
  };

  const groupOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: NONE_GROUP, label: t("noGroup") },
    ];
    for (const g of groups) opts.push({ value: g.id, label: g.label });
    return opts;
  }, [groups, t]);

  const roleSelectItems = useMemo(
    () =>
      roles.map((r) => ({
        value: r.slug,
        label: r.name,
      })),
    [roles],
  );

  const rowByItem = useMemo(() => {
    const map = new Map<string, FlatRow>();
    for (const r of rows) map.set(r.itemId, r);
    return map;
  }, [rows]);

  const rowsByGroup = useMemo(() => {
    const map = new Map<string, FlatRow[]>();
    for (const r of rows) {
      if (r.groupId === NONE_GROUP) continue;
      if (!map.has(r.groupId)) map.set(r.groupId, []);
      map.get(r.groupId)!.push(r);
    }
    return map;
  }, [rows]);

  const sortableIds = useMemo(() => {
    const ids = order.map((entry) => orderEntryId(entry));
    for (const r of rows) {
      if (r.groupId !== NONE_GROUP) ids.push(rowItemId(r.itemId));
    }
    return ids;
  }, [order, rows]);

  if (roles.length === 0 && !loading) {
    return <p className="text-sm text-muted-foreground">{t("noRoles")}</p>;
  }


  const renderRowControls = (
    r: FlatRow,
    orderNum: string,
    drag?: SortableHandleProps,
  ) => (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-1 shadow-sm",
        r.hidden && "opacity-50",
      )}
    >
      {drag ? (
        <SortableDragHandle
          title={t("dragToReorder")}
          attributes={drag.attributes}
          listeners={drag.listeners}
        />
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <span className="w-6 shrink-0 text-center text-[10px] font-medium tabular-nums text-muted-foreground">
        {orderNum}
      </span>
      <IconPicker
        value={r.icon}
        onChange={(icon) => updateRow(r.itemId, { icon })}
        compact
      />
      <Input
        value={r.label}
        onChange={(e) => updateRow(r.itemId, { label: e.target.value })}
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <Select
        items={groupOptions}
        value={r.groupId}
        onValueChange={(v) => v && updateRow(r.itemId, { groupId: v })}
      >
        <SelectTrigger className="h-7 w-[108px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groupOptions.map((o) => (
            <SelectItem
              key={o.value}
              value={o.value}
              label={o.label}
              className="text-xs"
            >
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => updateRow(r.itemId, { hidden: !r.hidden })}
        title={r.hidden ? t("show") : t("hide")}
        className="size-7 shrink-0 cursor-pointer"
      >
        {r.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => resetRow(r.itemId)}
        title={t("resetDefault")}
        className="size-7 shrink-0 cursor-pointer"
      >
        <RotateCcw className="size-3.5 text-muted-foreground" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      {roles.length > 0 && (
        <Tabs value={role} onValueChange={setRole}>
          <TabsList className="h-8">
            {roles.map((r) => (
              <TabsTrigger key={r.id} value={r.slug} className="cursor-pointer text-xs">
                {r.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {roles.length > 1 && (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <p className="mb-2 text-xs font-medium text-foreground">{t("copySectionTitle")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[120px] flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">{t("copyFrom")}</Label>
              <Select
                items={roleSelectItems}
                value={copyFromRole}
                onValueChange={(v) => v && setCopyFromRole(v)}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder={t("copyFrom")} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.slug} label={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="mb-1.5 hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
            <div className="min-w-[120px] flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">{t("copyTo")}</Label>
              <Select
                items={roleSelectItems}
                value={copyToRole}
                onValueChange={(v) => v && setCopyToRole(v)}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder={t("copyTo")} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.slug} label={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 cursor-pointer text-xs"
              disabled={copyRolesDisabled || copying || saving}
              onClick={() => void handleCopySettings()}
            >
              {copying ? (
                <Loader2 className="me-1 size-3.5 animate-spin" />
              ) : (
                <Copy className="me-1 size-3.5" />
              )}
              {copying ? t("copying") : t("copySettings")}
            </Button>
            {copyFromRole && copyFromRole !== role && copyToRole === role && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 cursor-pointer text-xs"
                disabled={loading || copying || saving}
                onClick={() => void handleLoadFromRole()}
              >
                {t("loadIntoEditor")}
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t("copySectionHint")}</p>
        </div>
      )}

      <Card className="rounded-lg border-border shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <MenuEditorDndProvider
              sortableIds={sortableIds}
              onOrderDragEnd={handleOrderDragEnd}
              onRowDragEnd={handleRowDragEnd}
            >
              <div className="grid grid-cols-1 gap-2 p-3 xl:grid-cols-2">
                {order.map((entry, entryIdx) => {
                  const orderNum = String(entryIdx + 1);
                  if (entry.kind === "item") {
                    const r = rowByItem.get(entry.id);
                    if (!r || r.groupId !== NONE_GROUP) return null;
                    return (
                      <SortableShell
                        key={`item-${entry.id}`}
                        id={orderEntryId(entry)}
                        className="min-w-0"
                      >
                        {({ attributes, listeners }) => (
                          <div>
                            <span className="mb-0.5 block px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {orderNum}. {t("topLevel")}
                            </span>
                            {renderRowControls(r, orderNum, { attributes, listeners })}
                          </div>
                        )}
                      </SortableShell>
                    );
                  }
                  const g = groups.find((x) => x.id === entry.id);
                  if (!g) return null;
                  const sectionRows = rowsByGroup.get(g.id) || [];
                  const isPanel = g.displayMode === "panel";
                  return (
                    <SortableShell
                      key={`group-${g.id}`}
                      id={orderEntryId(entry)}
                      className="col-span-full min-w-0"
                    >
                      {({ attributes, listeners }) => (
                        <div className="rounded-md border border-border/70 bg-muted/15 p-2">
                          <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            <SortableDragHandle
                              title={t("dragToReorder")}
                              attributes={attributes}
                              listeners={listeners}
                            />
                            <span className="w-5 text-center text-[10px] font-medium tabular-nums text-muted-foreground">
                              {orderNum}
                            </span>
                            <IconPicker
                              value={g.icon || "Folder"}
                              compact
                              onChange={(icon) => {
                                setGroups((gs) =>
                                  gs.map((x) => (x.id === g.id ? { ...x, icon } : x)),
                                );
                                setDirty(true);
                              }}
                            />
                            <Input
                              value={g.label}
                              onChange={(e) => renameGroup(g.id, e.target.value)}
                              className="h-7 max-w-[160px] text-[10px] font-semibold uppercase tracking-wide"
                            />
                            <span className="text-[10px] text-muted-foreground">
                              ({sectionRows.length})
                            </span>
                            <div className="ms-auto flex items-center gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant={isPanel ? "default" : "outline"}
                                onClick={() => toggleGroupMode(g.id)}
                                title={isPanel ? t("modeHintPanel") : t("modeHintInline")}
                                className="h-6 gap-1 px-2 text-[10px] cursor-pointer"
                              >
                                <PanelRight className="size-3" />
                                {isPanel ? t("panel") : t("inline")}
                              </Button>
                              {g.id.startsWith("group-custom-") && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => deleteGroup(g.id)}
                                  className="size-6 cursor-pointer"
                                >
                                  <Trash2 className="size-3.5 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                            {sectionRows.map((r, idx) => (
                              <SortableShell key={r.itemId} id={rowItemId(r.itemId)}>
                                {({ attributes, listeners }) =>
                                  renderRowControls(r, `${orderNum}.${idx + 1}`, {
                                    attributes,
                                    listeners,
                                  })
                                }
                              </SortableShell>
                            ))}
                          </div>
                        </div>
                      )}
                    </SortableShell>
                  );
                })}
              </div>
            </MenuEditorDndProvider>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 cursor-pointer text-xs" onClick={addGroup}>
          <FolderPlus className="me-1 size-3.5" />
          {t("addGroup")}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 cursor-pointer text-xs" onClick={handleReset}>
          {t("resetAll")}
        </Button>
        <div className="flex-1" />
        {dirty && (
          <span className="text-xs text-amber-600 dark:text-amber-400">{t("unsavedChanges")}</span>
        )}
        <Button type="button" size="sm" className="h-8 cursor-pointer text-xs" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
