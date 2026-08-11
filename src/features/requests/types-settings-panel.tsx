"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Banknote,
  Calendar,
  Coins,
  ExternalLink,
  FileText,
  Fuel,
  MessageSquareWarning,
  Package,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Link } from "@/i18n/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TYPE_FIELDS } from "./request-typed-fields";
import {
  fetchRequestTypeScreenshotPolicy,
  updateRequestTypeScreenshotPolicy,
} from "./requests-settings-actions";
import { REQUEST_TYPE_SLUGS, type RequestTypeSlug } from "./settings-types";

const TYPE_ICONS: Record<RequestTypeSlug, LucideIcon> = {
  leave: Calendar,
  loan: Coins,
  sick_leave: Stethoscope,
  asset: Package,
  fuel: Fuel,
  document: FileText,
  complaint: MessageSquareWarning,
  salary_justification: Banknote,
};

type PolicyState = { screenshot_restricted: boolean; is_active: boolean };

export function TypesSettingsPanel() {
  const t = useTranslations("pages.requests.settings.types");
  const tTypes = useTranslations("pages.requests.types");
  const [policies, setPolicies] = useState<Record<string, PolicyState>>({});
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchRequestTypeScreenshotPolicy();
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const map: Record<string, PolicyState> = {};
    for (const row of result.rows) {
      map[row.request_type] = {
        screenshot_restricted: row.screenshot_restricted,
        is_active: row.is_active,
      };
    }
    setPolicies(map);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(slug: RequestTypeSlug, field: keyof PolicyState) {
    const current = policies[slug];
    if (!current) return;
    const next = { ...current, [field]: !current[field] };
    setPolicies((prev) => ({ ...prev, [slug]: next }));
    startTransition(async () => {
      const result = await updateRequestTypeScreenshotPolicy(slug, {
        [field]: next[field],
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        setPolicies((prev) => ({ ...prev, [slug]: current }));
      }
    });
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      <AppListCard className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colType")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colFields")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colScreenshots")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {REQUEST_TYPE_SLUGS.map((slug) => {
              const Icon = TYPE_ICONS[slug];
              const fields = TYPE_FIELDS[slug] ?? [];
              const policy = policies[slug];
              return (
                <TableRow key={slug}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-medium">{tTypes(slug)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                    {fields.slice(0, 3).map((f) => f.label).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    {loading || !policy ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <ToggleChip
                        selected={policy.screenshot_restricted}
                        onClick={() => toggle(slug, "screenshot_restricted")}
                      >
                        {policy.screenshot_restricted ? t("blocked") : t("allowed")}
                      </ToggleChip>
                    )}
                  </TableCell>
                  <TableCell>
                    {loading || !policy ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <ToggleChip
                        selected={policy.is_active}
                        onClick={() => toggle(slug, "is_active")}
                      >
                        {policy.is_active ? t("activeOn") : t("activeOff")}
                      </ToggleChip>
                    )}
                  </TableCell>
                  <TableCell>
                    {slug === "complaint" ? (
                      <Link
                        href="/requests/settings/categories"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("manageCategories")}
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </AppListCard>

      <p className="text-[10px] text-muted-foreground">{t("deferredNote")}</p>
    </AppPage>
  );
}
