"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentOption } from "@/components/app/toggle-chip";
import { selectOptionsFrom } from "@/lib/select-items";
import {
  copyAccess,
  diffAccess,
  ticksToAppAccess,
  type AppAccessMap,
} from "@/lib/auth/app-access";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import {
  copyRoleTemplateTicks,
  getUserTicksForCopy,
  type RequestTypeGrant,
  type StaffAccessListRow,
} from "@/features/settings/staff-access-actions";

type CopyTab = "user" | "role";

export function CopyAccessDialog({
  open,
  onOpenChange,
  current,
  users,
  roles,
  currentUserId,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: AppAccessMap;
  users: StaffAccessListRow[];
  roles: AdminRoleRow[];
  currentUserId: string;
  onApply: (next: AppAccessMap, requestTypes?: RequestTypeGrant[]) => void;
}) {
  const t = useTranslations("pages.settings.accessControl");
  const [tab, setTab] = useState<CopyTab>("user");
  const [sourceUserId, setSourceUserId] = useState<string | null>(null);
  const [sourceRoleId, setSourceRoleId] = useState("");
  const [keepSubViews, setKeepSubViews] = useState(false);
  const [preview, setPreview] = useState<AppAccessMap | null>(null);
  const [copiedTypes, setCopiedTypes] = useState<RequestTypeGrant[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleItems = selectOptionsFrom(
    roles.filter((role) => !role.isSuperAdmin),
    (role) => role.id,
    (role) => role.name,
  );

  const userItems = useMemo(
    () =>
      users
        .filter((row) => row.id !== currentUserId)
        .map((row) => ({
          value: row.id,
          label: row.fullName ?? row.email ?? row.id,
          hint: row.roleName ?? undefined,
          keywords: [row.email, row.roleName, row.fullName].filter(Boolean) as string[],
        })),
    [users, currentUserId],
  );

  const diff = preview ? diffAccess(current, preview) : null;

  const loadPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      if (tab === "user") {
        if (!sourceUserId) {
          setError(t("errors.copySourceRequired"));
          return;
        }
        const loaded = await getUserTicksForCopy(sourceUserId);
        if (loaded.error || !loaded.slugs) {
          setError(t("errors.copyFailed"));
          return;
        }
        const source = ticksToAppAccess(loaded.slugs);
        setPreview(copyAccess(source, current, keepSubViews));
        setCopiedTypes(keepSubViews ? undefined : loaded.requestTypes);
      } else {
        if (!sourceRoleId) {
          setError(t("errors.copySourceRequired"));
          return;
        }
        const loaded = await copyRoleTemplateTicks(sourceRoleId);
        if (loaded.error || !loaded.slugs) {
          setError(t("errors.copyFailed"));
          return;
        }
        setPreview(copyAccess(ticksToAppAccess(loaded.slugs), current, keepSubViews));
        setCopiedTypes(undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!preview) return;
    onApply(preview, copiedTypes);
    onOpenChange(false);
    setPreview(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) {
          setPreview(null);
          setError(null);
        }
      }}
    >
      <DialogContent
        className="flex w-[min(640px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton
        closeOutside
      >
        <div className="space-y-3 px-5 pt-4 pb-2">
          <div className="flex gap-1">
            <SegmentOption selected={tab === "user"} onClick={() => { setTab("user"); setPreview(null); }}>
              {t("copyFromUser")}
            </SegmentOption>
            <SegmentOption selected={tab === "role"} onClick={() => { setTab("role"); setPreview(null); }}>
              {t("copyFromRole")}
            </SegmentOption>
          </div>
          {tab === "user" ? (
            <SearchSelect
              items={userItems}
              value={sourceUserId}
              onChange={setSourceUserId}
              placeholder={t("copyUserPlaceholder")}
              searchPlaceholder={t("searchUsers")}
              recentsKey="access-copy-user"
            />
          ) : (
            <Select
              items={roleItems}
              value={sourceRoleId}
              onValueChange={(value) => setSourceRoleId(value ?? "")}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={t("copyRolePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {roles.filter((role) => !role.isSuperAdmin).map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={keepSubViews}
              onCheckedChange={(checked) => {
                setKeepSubViews(checked === true);
                setPreview(null);
              }}
            />
            {t("keepSubViews")}
          </label>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {diff ? (
            <ul className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <li>{t("diffAdded", { count: diff.addedApps.length })}</li>
              <li>{t("diffRemoved", { count: diff.removedApps.length })}</li>
              <li>{t("diffLevels", { count: diff.levelChanges.length })}</li>
              <li>{t("diffSubViews", { added: diff.subViewAdds.length, removed: diff.subViewRemoves.length })}</li>
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("copyPreviewHint")}</p>
          )}
        </div>
        <AppModalFooter title={t("copyTitle")} subtitle={t("copySubtitle")}>
          <Button type="button" variant="outline" className="h-9" onClick={loadPreview} disabled={busy}>
            {t("previewDiff")}
          </Button>
          <Button type="button" className="h-9" onClick={apply} disabled={!preview || busy}>
            {t("applyCopy")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
