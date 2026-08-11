"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  Loader2,
  LogIn,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { selectOptions } from "@/lib/select-items";
import {
  fetchStepTemplates,
  upsertStepTemplates,
} from "./requests-settings-actions";
import {
  REQUEST_TYPE_SLUGS,
  STEP_ALLOWED_ACTIONS,
  type RequestTypeSlug,
  type StepTemplateRow,
} from "./settings-types";

function emptyStep(order: number): StepTemplateRow {
  return {
    step_order: order,
    step_name: "",
    role_key: "",
    is_system_auto: false,
    allowed_actions: ["approve", "reject"],
  };
}

function normalizeOrders(steps: StepTemplateRow[]): StepTemplateRow[] {
  return steps.map((step, index) => ({
    ...step,
    step_order: index + 1,
  }));
}

/** Visual connector line between step chain cards — matches Figma 05-Workflow-Builder-Settings. */
function ChainConnector() {
  return (
    <div className="flex justify-center">
      <div className="h-3 w-px bg-border" />
    </div>
  );
}

export function WorkflowsSettingsPanel() {
  const t = useTranslations("pages.requests.settings.workflows");
  const tTypes = useTranslations("pages.requests.types");
  const tRequests = useTranslations("pages.requests");
  const [requestType, setRequestType] = useState<RequestTypeSlug>("leave");
  const [steps, setSteps] = useState<StepTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadSteps = useCallback(async (type: RequestTypeSlug) => {
    setLoading(true);
    const result = await fetchStepTemplates(type);
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
      setSteps([]);
      return;
    }
    setSteps(result.steps.length > 0 ? result.steps : [emptyStep(1)]);
    setDirty(false);
  }, []);

  useEffect(() => {
    void loadSteps(requestType);
  }, [requestType, loadSteps]);

  const typeOptions = useMemo(
    () =>
      REQUEST_TYPE_SLUGS.map((slug) => ({
        value: slug,
        label: tTypes(slug),
      })),
    [tTypes],
  );

  function updateStep(index: number, patch: Partial<StepTemplateRow>) {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, ...patch } : step)));
    setDirty(true);
  }

  function toggleAction(index: number, action: string) {
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i !== index || step.is_system_auto) return step;
        const has = step.allowed_actions.includes(action);
        return {
          ...step,
          allowed_actions: has
            ? step.allowed_actions.filter((a) => a !== action)
            : [...step.allowed_actions, action],
        };
      }),
    );
    setDirty(true);
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return normalizeOrders(next);
    });
    setDirty(true);
  }

  function addStep() {
    setSteps((prev) => normalizeOrders([...prev, emptyStep(prev.length + 1)]));
    setDirty(true);
  }

  function removeStep(index: number) {
    setSteps((prev) => normalizeOrders(prev.filter((_, i) => i !== index)));
    setDirty(true);
  }

  function handleSave() {
    const invalid = steps.some(
      (step) => !step.step_name.trim() || !step.role_key.trim(),
    );
    if (invalid) {
      toast.error(t("errors.missingFields"));
      return;
    }

    startTransition(async () => {
      const result = await upsertStepTemplates(requestType, normalizeOrders(steps));
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("saved"));
      await loadSteps(requestType);
    });
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("titleFor", { type: tTypes(requestType) })}
        description={t("subtitleFor", { type: tTypes(requestType) })}
        breadcrumbs={[
          { label: tRequests("title"), href: "/requests" },
          { label: t("hub"), href: "/requests/settings" },
          { label: t("breadcrumb") },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {dirty ? (
              <span className="rounded-full border border-warning-bg bg-warning-bg px-2 py-0.5 text-[11px] font-medium text-warning">
                {t("unsavedChanges")}
              </span>
            ) : null}
            <div className="min-w-[160px]">
              <Select
                value={requestType}
                onValueChange={(v) => v && setRequestType(v as RequestTypeSlug)}
                items={selectOptions(typeOptions)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="h-9"
              onClick={handleSave}
              disabled={isPending || loading || !dirty}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("save")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <AppListCard className="space-y-1 p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
                  <LogIn className="h-3.5 w-3.5" />
                  {t("chainStart", { type: tTypes(requestType) })}
                </span>
              </div>

              {steps.map((step, index) => (
                <div key={`${step.id ?? "new"}-${index}`}>
                  <ChainConnector />
                  <div className="rounded-xl border border-border bg-background px-3 py-1.5 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {step.step_order}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <Input
                          className="h-9 min-w-[150px] flex-1"
                          value={step.step_name}
                          placeholder={t("colName")}
                          aria-label={t("colName")}
                          onChange={(e) => updateStep(index, { step_name: e.target.value })}
                        />
                        <Input
                          className="h-9 w-[150px]"
                          value={step.role_key}
                          placeholder={t("colRole")}
                          aria-label={t("colRole")}
                          onChange={(e) => updateStep(index, { role_key: e.target.value })}
                        />
                        <ToggleChip
                          selected={step.is_system_auto}
                          onClick={() =>
                            updateStep(index, {
                              is_system_auto: !step.is_system_auto,
                              allowed_actions: !step.is_system_auto ? [] : ["approve", "reject"],
                            })
                          }
                          size="md"
                        >
                          {t("systemAuto")}
                        </ToggleChip>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={index === 0}
                            onClick={() => moveStep(index, -1)}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={index === steps.length - 1}
                            onClick={() => moveStep(index, 1)}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            disabled={steps.length <= 1}
                            onClick={() => removeStep(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 ps-8">
                      {STEP_ALLOWED_ACTIONS.map((action) => (
                        <ToggleChip
                          key={action}
                          selected={step.allowed_actions.includes(action)}
                          disabled={step.is_system_auto}
                          onClick={() => toggleAction(index, action)}
                          size="sm"
                        >
                          {t(`actions.${action}` as "actions.approve")}
                        </ToggleChip>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              <ChainConnector />
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full"
                  onClick={addStep}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t("addStep")}
                </Button>
              </div>
              <ChainConnector />
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success-bg bg-success-bg px-3 py-1 text-xs font-medium text-success">
                  <CircleCheck className="h-3.5 w-3.5" />
                  {t("chainEnd")}
                </span>
              </div>
            </div>
          )}
        </AppListCard>

        <AppListCard className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("howRoutingWorks")}</h3>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("howRoutingWorksBody")}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {t("hint")}{" "}
            <Link href="/requests/settings/roles" className="text-primary hover:underline">
              {t("rolesLink")}
            </Link>
          </p>
          <p className="border-t border-border pt-2 text-[10px] text-muted-foreground">
            {t("slaGapNote")}
          </p>
        </AppListCard>
      </div>
    </AppPage>
  );
}
