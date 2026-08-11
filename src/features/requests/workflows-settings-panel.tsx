"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
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

export function WorkflowsSettingsPanel() {
  const t = useTranslations("pages.requests.settings.workflows");
  const tTypes = useTranslations("pages.requests.types");
  const [requestType, setRequestType] = useState<RequestTypeSlug>("leave");
  const [steps, setSteps] = useState<StepTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
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
    setSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
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
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return normalizeOrders(next);
    });
  }

  function addStep() {
    setSteps((prev) => normalizeOrders([...prev, emptyStep(prev.length + 1)]));
  }

  function removeStep(index: number) {
    setSteps((prev) => normalizeOrders(prev.filter((_, i) => i !== index)));
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
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
        actions={
          <Button size="sm" onClick={handleSave} disabled={isPending || loading}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("save")}
          </Button>
        }
      />

      <AppListCard className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label className="text-xs">{t("requestType")}</Label>
            <Select value={requestType} onValueChange={(v) => v && setRequestType(v as RequestTypeSlug)}>
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
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={addStep}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("addStep")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colOrder")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colRole")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colSystem")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colActions")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((step, index) => (
                  <TableRow key={`${step.id ?? "new"}-${index}`}>
                    <TableCell className="w-12 text-center text-xs">{step.step_order}</TableCell>
                    <TableCell>
                      <Input
                        className="h-9"
                        value={step.step_name}
                        onChange={(e) => updateStep(index, { step_name: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-9"
                        value={step.role_key}
                        onChange={(e) => updateStep(index, { role_key: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <ToggleChip
                        selected={step.is_system_auto}
                        onClick={() =>
                          updateStep(index, {
                            is_system_auto: !step.is_system_auto,
                            allowed_actions: !step.is_system_auto ? [] : ["approve", "reject"],
                          })
                        }
                      >
                        {t("systemAuto")}
                      </ToggleChip>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
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
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          {t("hint")}{" "}
          <Link href="/requests/settings/roles" className="text-primary hover:underline">
            {t("rolesLink")}
          </Link>
        </p>
      </AppListCard>
    </AppPage>
  );
}
