"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppFormSection, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchSelect } from "@/components/ui/search-select";
import {
  CUSTOM_FIELD_TYPES,
  DRIVER_ENTITY_TYPE,
  type CustomFieldDefinition,
  type CustomFieldOption,
  type CustomFieldType,
} from "@/lib/custom-fields/types";
import { normalizeFieldKey } from "@/lib/custom-fields/validate";
import {
  useArchiveCustomFieldDefinition,
  useCustomFieldDefinitions,
  useReorderCustomFieldDefinitions,
  useSetCustomFieldActive,
  useUpsertCustomFieldDefinition,
} from "./use-custom-fields";
import {
  getRoleUiDefault,
  saveRoleUiDefault,
} from "@/features/settings/ui-preferences-actions";
import {
  DRIVERS_LIST_COLUMNS_PREF_KEY,
  type ListColumnPreference,
} from "@/lib/ui-preferences/types";
import { customFieldColumnId } from "@/lib/custom-fields/types";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const STANDARD_COLUMN_IDS = [
  "driverId",
  "employeeId",
  "riderCategory",
  "name",
  "phone",
  "restaurants",
  "zone",
  "todayDeliveries",
  "status",
  "attendance",
  "passcode",
] as const;

function emptyDraft(): {
  id?: string;
  key: string;
  label: string;
  field_type: CustomFieldType;
  required: boolean;
  options: CustomFieldOption[];
  default_value: string;
  is_active: boolean;
} {
  return {
    key: "",
    label: "",
    field_type: "text",
    required: false,
    options: [{ value: "", label: "" }],
    default_value: "",
    is_active: true,
  };
}

export function DriverFieldsSettingsPanel() {
  const t = useTranslations("pages.driverFieldsSettings");
  const { data: defs = [], isLoading } = useCustomFieldDefinitions({
    includeInactive: true,
  });
  const upsert = useUpsertCustomFieldDefinition();
  const setActive = useSetCustomFieldActive();
  const archive = useArchiveCustomFieldDefinition();
  const reorder = useReorderCustomFieldDefinitions();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [isPending, startTransition] = useTransition();

  const rolesQuery = useQuery({
    queryKey: ["admin-roles-options"],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("admin_roles")
        .select("id, name, slug")
        .order("name");
      return data ?? [];
    },
  });

  const [roleId, setRoleId] = useState("");
  const knownColumnIds = useMemo(() => {
    return [
      ...STANDARD_COLUMN_IDS,
      ...defs.filter((d) => d.is_active).map((d) => customFieldColumnId(d.key)),
    ];
  }, [defs]);

  const roleDefaultQuery = useQuery({
    queryKey: ["role-ui-default", roleId, DRIVERS_LIST_COLUMNS_PREF_KEY],
    enabled: Boolean(roleId),
    queryFn: () => getRoleUiDefault(roleId, DRIVERS_LIST_COLUMNS_PREF_KEY),
  });

  const [roleVisible, setRoleVisible] = useState<string[]>([]);
  const [roleOrder, setRoleOrder] = useState<string[]>([]);

  useEffect(() => {
    const pref = roleDefaultQuery.data;
    if (pref) {
      setRoleVisible(pref.visible);
      setRoleOrder(pref.order.length ? pref.order : [...knownColumnIds]);
    } else if (roleId) {
      setRoleVisible([...STANDARD_COLUMN_IDS]);
      setRoleOrder([...knownColumnIds]);
    }
  }, [roleDefaultQuery.data, roleId, knownColumnIds]);

  function openCreate() {
    setDraft(emptyDraft());
    setOpen(true);
  }

  function openEdit(def: CustomFieldDefinition) {
    setDraft({
      id: def.id,
      key: def.key,
      label: def.label,
      field_type: def.field_type,
      required: def.required,
      options: def.options.length ? def.options : [{ value: "", label: "" }],
      default_value:
        def.default_value == null ? "" : String(def.default_value),
      is_active: def.is_active,
    });
    setOpen(true);
  }

  function saveDraft() {
    startTransition(async () => {
      const key = draft.id ? draft.key : normalizeFieldKey(draft.key);
      if (!key || !draft.label.trim()) {
        toast.error(t("invalidDefinition"));
        return;
      }
      const result = await upsert.mutateAsync({
        id: draft.id,
        entity_type: DRIVER_ENTITY_TYPE,
        key,
        label: draft.label.trim(),
        field_type: draft.field_type,
        required: draft.required,
        options: draft.field_type === "select" ? draft.options : [],
        default_value:
          draft.default_value === ""
            ? null
            : draft.field_type === "checkbox"
              ? draft.default_value === "true"
              : draft.field_type === "number"
                ? Number(draft.default_value)
                : draft.default_value,
        is_active: draft.is_active,
      });
      if (result.error) {
        toast.error(t(`errors.${result.error}` as "errors.save_failed"));
        return;
      }
      toast.success(t("saved"));
      setOpen(false);
    });
  }

  function moveDef(index: number, dir: -1 | 1) {
    const next = [...defs];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    startTransition(async () => {
      const result = await reorder.mutateAsync(next.map((d) => d.id));
      if (result.error) toast.error(t("errors.save_failed"));
    });
  }

  function saveRoleDefault() {
    if (!roleId) return;
    startTransition(async () => {
      const value: ListColumnPreference = {
        order: roleOrder.length ? roleOrder : [...knownColumnIds],
        visible: roleVisible.length ? roleVisible : [...STANDARD_COLUMN_IDS],
        sort: null,
      };
      const result = await saveRoleUiDefault(roleId, DRIVERS_LIST_COLUMNS_PREF_KEY, value);
      if (result.error) {
        toast.error(t("errors.save_failed"));
        return;
      }
      toast.success(t("roleDefaultSaved"));
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button type="button" className="h-9" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("addField")}
          </Button>
        }
      />

      <AppFormSection title="">
        <div className="space-y-2">
          {defs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            defs.map((def, index) => (
              <div
                key={def.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{def.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {def.key} · {def.field_type}
                    {def.required ? ` · ${t("required")}` : ""}
                    {!def.is_active ? ` · ${t("inactive")}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => moveDef(index, -1)}
                  disabled={index === 0 || isPending}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => moveDef(index, 1)}
                  disabled={index === defs.length - 1 || isPending}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => openEdit(def)}
                >
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() =>
                    startTransition(async () => {
                      await setActive.mutateAsync({
                        id: def.id,
                        active: !def.is_active,
                      });
                    })
                  }
                >
                  {def.is_active ? t("deactivate") : t("activate")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 text-destructive hover:bg-destructive/10"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await archive.mutateAsync(def.id);
                      if (result.error) toast.error(t("errors.save_failed"));
                      else toast.success(t("archived"));
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </AppFormSection>

      {/* Temporarily hidden — role list column defaults editor */}
      {false ? (
      <AppFormSection title={t("roleDefaultsTitle")} description={t("roleDefaultsHint")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("role")}</Label>
            <SearchSelect
              items={(rolesQuery.data ?? []).map((r) => ({
                value: r.id,
                label: r.name,
                keywords: [r.slug, r.name],
              }))}
              value={roleId || null}
              onChange={(v) => setRoleId(v ?? "")}
              placeholder={t("selectRole")}
              searchPlaceholder={t("searchRoles")}
              recentsKey="driver-fields-role"
            />
          </div>
        </div>
        {roleId ? (
          <div className="mt-3 space-y-2">
            {knownColumnIds.map((id) => (
              <label
                key={id}
                className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm"
              >
                <Checkbox
                  checked={roleVisible.includes(id)}
                  onCheckedChange={(checked) => {
                    setRoleVisible((prev) =>
                      checked === true
                        ? [...new Set([...prev, id])]
                        : prev.filter((x) => x !== id),
                    );
                    setRoleOrder((prev) =>
                      prev.includes(id) ? prev : [...prev, id],
                    );
                  }}
                />
                <span>{id.startsWith("cf:") ? id.slice(3) : id}</span>
              </label>
            ))}
            <Button type="button" className="h-9" onClick={saveRoleDefault} disabled={isPending}>
              {t("saveRoleDefault")}
            </Button>
          </div>
        ) : null}
      </AppFormSection>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex max-h-[92vh] w-[min(640px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
          showCloseButton
          closeOutside
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("label")}</Label>
                <Input
                  className="h-9"
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("key")}</Label>
                <Input
                  className="h-9"
                  value={draft.key}
                  disabled={Boolean(draft.id)}
                  onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("type")}</Label>
                <Select
                  value={draft.field_type}
                  onValueChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      field_type: (v as CustomFieldType) ?? "text",
                    }))
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOM_FIELD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`types.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("defaultValue")}</Label>
                <Input
                  className="h-9"
                  value={draft.default_value}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, default_value: e.target.value }))
                  }
                />
              </div>
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <Checkbox
                checked={draft.required}
                onCheckedChange={(c) =>
                  setDraft((d) => ({ ...d, required: c === true }))
                }
              />
              {t("required")}
            </label>
            {draft.field_type === "select" ? (
              <div className="space-y-2">
                <Label>{t("options")}</Label>
                {draft.options.map((opt, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2">
                    <Input
                      className="h-9"
                      placeholder={t("optionValue")}
                      value={opt.value}
                      onChange={(e) =>
                        setDraft((d) => {
                          const options = [...d.options];
                          options[i] = { ...options[i]!, value: e.target.value };
                          return { ...d, options };
                        })
                      }
                    />
                    <Input
                      className="h-9"
                      placeholder={t("optionLabel")}
                      value={opt.label}
                      onChange={(e) =>
                        setDraft((d) => {
                          const options = [...d.options];
                          options[i] = { ...options[i]!, label: e.target.value };
                          return { ...d, options };
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      options: [...d.options, { value: "", label: "" }],
                    }))
                  }
                >
                  {t("addOption")}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="px-5 pb-4">
            <AppModalFooter title={draft.id ? t("editField") : t("addField")} subtitle={t("modalSubtitle")}>
              <Button type="button" variant="outline" className="h-9" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="button" className="h-9" onClick={saveDraft} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("save")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
