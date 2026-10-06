"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppListCard } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { selectOptions } from "@/lib/select-items";
import { ESIGN_STAFF_SIGNER_ROLES, type EsignStaffSignerRole } from "./types";
import {
  useAddEsignSigner,
  useEsignSignerOptions,
  useEsignSigners,
  useRemoveEsignSigner,
} from "./use-esign";

export type EsignDraftStaffSigner = {
  staff_user_id: string;
  role: EsignStaffSignerRole;
  display_name: string;
};

export function EsignSignersEditor({
  requestId,
  draft = [],
  onDraftChange,
}: {
  requestId?: string;
  draft?: EsignDraftStaffSigner[];
  onDraftChange?: (next: EsignDraftStaffSigner[]) => void;
}) {
  const t = useTranslations("pages.requests.esign.signers");
  const persisted = Boolean(requestId);
  const { data: optionsData } = useEsignSignerOptions();
  const { data: signersData } = useEsignSigners(requestId ?? "");
  const add = useAddEsignSigner(requestId ?? "");
  const remove = useRemoveEsignSigner(requestId ?? "");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [role, setRole] = useState<EsignStaffSignerRole>("countersigner");

  const options = optionsData?.rows ?? [];
  const items = options.map((row) => ({
    value: row.id,
    label: row.full_name || row.email || row.id,
    hint: row.email ?? row.phone ?? undefined,
    keywords: [row.full_name ?? "", row.email ?? "", row.phone ?? ""],
  }));

  const persistedRows = (signersData?.rows ?? []).filter((row) => row.is_staff_signer);
  const draftRows = persisted ? [] : draft;
  function roleLabel(value: string) {
    if (value === "manager") return t("roles.manager");
    if (value === "witness") return t("roles.witness");
    return t("roles.countersigner");
  }

  async function addSigner() {
    if (!staffId) return;
    const picked = options.find((row) => row.id === staffId);
    const displayName = picked?.full_name || picked?.email || "";
    if (persisted && requestId) {
      const result = await add.mutateAsync({
        request_id: requestId,
        staff_user_id: staffId,
        role,
        display_name: displayName,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("addFailed"));
        return;
      }
    } else {
      if (draftRows.some((row) => row.staff_user_id === staffId && row.role === role)) return;
      onDraftChange?.([...draftRows, { staff_user_id: staffId, role, display_name: displayName }]);
    }
    setStaffId(null);
  }

  async function removeSigner(id: string, staffUserId?: string, staffRole?: string) {
    if (persisted) {
      const result = await remove.mutateAsync(id);
      if (!result.ok) toast.error(result.error ?? t("removeFailed"));
      return;
    }
    onDraftChange?.(
      draftRows.filter((row) => !(row.staff_user_id === staffUserId && row.role === staffRole)),
    );
  }

  return (
    <AppListCard className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Users className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-[10px] text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
        <div className="space-y-1">
          <Label>{t("staff")}</Label>
          <SearchSelect
            items={items}
            value={staffId}
            onChange={setStaffId}
            placeholder={t("staffPlaceholder")}
            searchPlaceholder={t("staffSearch")}
            recentsKey="esign-staff-signer"
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("role")}</Label>
          <Select
            items={selectOptions(
              ESIGN_STAFF_SIGNER_ROLES.map((value) => ({
                value,
                label: roleLabel(value),
              })),
            )}
            value={role}
            onValueChange={(value) => {
              if (value === "countersigner" || value === "manager" || value === "witness") {
                setRole(value);
              }
            }}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESIGN_STAFF_SIGNER_ROLES.map((value) => (
                <SelectItem key={value} value={value}>
                  {roleLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          className="h-9"
          disabled={!staffId || add.isPending}
          onClick={() => void addSigner()}
        >
          <Plus className="me-1.5 h-3.5 w-3.5" />
          {t("add")}
        </Button>
      </div>
      {persistedRows.length === 0 && draftRows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {persistedRows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {row.display_name || row.staff_contact || "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {roleLabel(row.role)} · {row.status}
                </p>
              </div>
              {row.status === "signed" ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-destructive hover:bg-destructive/10"
                  onClick={() => void removeSigner(row.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
          {draftRows.map((row) => (
            <li
              key={`${row.staff_user_id}-${row.role}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{row.display_name || "—"}</p>
                <p className="text-[10px] text-muted-foreground">{roleLabel(row.role)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:bg-destructive/10"
                onClick={() => void removeSigner("", row.staff_user_id, row.role)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </AppListCard>
  );
}
