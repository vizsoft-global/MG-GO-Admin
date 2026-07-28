"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Pause, Play, Save } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import {
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_AUTOMATION_TRIGGERS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
} from "./constants";
import {
  buildActionParams,
  NotificationActionFields,
  parseActionFields,
} from "./notification-action-fields";
import { RequiredLabel } from "./notification-form-primitives";
import { NotificationTargetingFields } from "./notification-targeting-fields";
import {
  defaultTriggerConfig,
  NotificationTriggerFields,
} from "./notification-trigger-fields";
import { NotificationWizardStepper } from "./notification-wizard-stepper";
import { invalidateNotificationCaches } from "./invalidate-notification-caches";
import {
  buildTargetSpec,
  isAutomationContentValid,
  validateAutomationBeforeActivate,
  validateTriggerConfig,
} from "./notification-validation";
import {
  saveNotificationAutomation,
  setNotificationAutomationStatus,
  updateNotificationAutomation,
} from "./notifications-actions";
import {
  useNotificationAutomation,
  useNotificationAutomationRuns,
  useNotificationTemplates,
} from "./use-notifications";
import type {
  NotificationActionType,
  NotificationAutomationTrigger,
  NotificationCategory,
  NotificationPriority,
  TargetSpec,
} from "./types";

type StepId = "trigger" | "audience" | "content" | "limits" | "review";
const STEPS: StepId[] = ["trigger", "audience", "content", "limits", "review"];

export function AutomationBuilderPageShell({ automationId }: { automationId?: string }) {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const router = useRouter();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const canManage = auth.can("notifications.manage");
  const isEdit = Boolean(automationId);
  const [step, setStep] = useState<StepId>("trigger");
  const [pending, startTransition] = useTransition();

  const { data: existing, isLoading, refetch } = useNotificationAutomation(automationId ?? null);
  const { data: runs } = useNotificationAutomationRuns(automationId ?? null);
  const { data: templates } = useNotificationTemplates();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<NotificationAutomationTrigger>("inactivity");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({ inactivity_days: 7 });
  const [targetMode, setTargetMode] = useState<TargetSpec["mode"]>("all");
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [driverIds, setDriverIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [contentMode, setContentMode] = useState<"template" | "inline">("inline");
  const [templateId, setTemplateId] = useState<string>("");
  const [titleTemplate, setTitleTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [category, setCategory] = useState<NotificationCategory>("reminder");
  const [priority, setPriority] = useState<NotificationPriority>("normal");
  const [actionType, setActionType] = useState<NotificationActionType>("open_screen");
  const [actionFields, setActionFields] = useState<Record<string, string>>({ screen: "home" });
  const [throttleMinutes, setThrottleMinutes] = useState("60");
  const [cooldownMinutes, setCooldownMinutes] = useState("1440");
  const [maxRetries, setMaxRetries] = useState("3");

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setDescription(existing.description ?? "");
    setTriggerType(existing.trigger_type);
    setTriggerConfig(existing.trigger_config ?? {});
    const spec = existing.target_spec ?? { mode: "all" };
    setTargetMode(spec.mode ?? "all");
    setZoneIds(spec.zone_ids ?? []);
    setPartnerIds(spec.partner_ids ?? []);
    setDriverIds(spec.driver_ids ?? []);
    setStatuses(spec.statuses ?? []);
    if (existing.template_id) {
      setContentMode("template");
      setTemplateId(existing.template_id);
    } else {
      setContentMode("inline");
    }
    setTitleTemplate(existing.title_template ?? "");
    setBodyTemplate(existing.body_template ?? "");
    setCategory(existing.category);
    setPriority(existing.priority);
    setActionType(existing.action_type);
    setActionFields(parseActionFields(existing.action_type, existing.action_params ?? {}));
    setThrottleMinutes(String(existing.throttle_minutes));
    setCooldownMinutes(String(existing.cooldown_minutes));
    setMaxRetries(String(existing.max_retries));
  }, [existing]);

  const targetSpec = useMemo(
    () => buildTargetSpec({ targetMode, zoneIds, partnerIds, groupIds: [], driverIds, statuses }),
    [targetMode, zoneIds, partnerIds, driverIds, statuses],
  );

  const buildInput = () => ({
    name,
    description: description || null,
    triggerType,
    triggerConfig,
    conditionSpec: {},
    targetSpec,
    templateId: contentMode === "template" && templateId ? templateId : null,
    titleTemplate: contentMode === "inline" ? titleTemplate : null,
    bodyTemplate: contentMode === "inline" ? bodyTemplate : null,
    category,
    priority,
    actionType,
    actionParams: buildActionParams(actionType, actionFields),
    throttleMinutes: Number(throttleMinutes) || 60,
    cooldownMinutes: Number(cooldownMinutes) || 1440,
    maxRetries: Number(maxRetries) || 3,
  });

  const completedSteps = useMemo(() => {
    const done: StepId[] = [];
    if (name.trim() && validateTriggerConfig(triggerType, triggerConfig)) done.push("trigger");
    if (
      (targetMode === "all" ||
        (targetMode === "zone" && zoneIds.length > 0) ||
        (targetMode === "partner" && partnerIds.length > 0) ||
        (targetMode === "custom" && driverIds.length > 0) ||
        (targetMode === "status" && statuses.length > 0))
    ) {
      done.push("audience");
    }
    if (
      isAutomationContentValid({
        contentMode,
        templateId,
        titleTemplate,
        bodyTemplate,
      })
    ) {
      done.push("content");
    }
    if (Number(throttleMinutes) > 0 && Number(cooldownMinutes) > 0) done.push("limits");
    return done;
  }, [
    name,
    triggerType,
    triggerConfig,
    targetMode,
    zoneIds,
    partnerIds,
    driverIds,
    statuses,
    contentMode,
    templateId,
    titleTemplate,
    bodyTemplate,
    throttleMinutes,
    cooldownMinutes,
  ]);

  const canProceed =
    step === "trigger"
      ? Boolean(name.trim()) && validateTriggerConfig(triggerType, triggerConfig)
      : step === "audience"
        ? completedSteps.includes("audience")
        : step === "content"
          ? completedSteps.includes("content")
          : step === "limits"
            ? completedSteps.includes("limits")
            : true;

  const canActivate = validateAutomationBeforeActivate(buildInput());

  function goNext() {
    if (!canProceed) return;
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]!);
  }

  function goBack() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]!);
  }

  function handleSave() {
    if (!name.trim()) {
      toast.error(t("errors.invalid_input"));
      setStep("trigger");
      return;
    }
    startTransition(async () => {
      const input = buildInput();
      const result = isEdit
        ? await updateNotificationAutomation(automationId!, input)
        : await saveNotificationAutomation(input);
      if ("error" in result) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      await invalidateNotificationCaches(queryClient, { automationId: result.id });
      toast.success(isEdit ? t("automationUpdated") : t("automationCreated"));
      router.push(`/${locale}/notifications/automations/${result.id}`);
    });
  }

  function handleStatusChange(status: "active" | "paused" | "draft") {
    if (!automationId) return;
    if (status === "active" && !canActivate) {
      toast.error(t("errors.automationNotReady"));
      return;
    }
    startTransition(async () => {
      const result = await setNotificationAutomationStatus(automationId, status);
      if ("error" in result) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      await invalidateNotificationCaches(queryClient, { automationId });
      toast.success(t("automationStatusUpdated"));
      void refetch();
    });
  }

  if (isEdit && isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isEdit && !isLoading && !existing) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">{t("automationNotFound")}</p>
    );
  }

  const wizardSteps = STEPS.map((id) => ({ id, label: t(`automationWizardSteps.${id}`) }));

  return (
    <AppPage narrow>
      <AppPageHeader
        title={isEdit ? t("automationEditTitle") : t("automationCreateTitle")}
        description={t("automationBuilderSubtitle")}
        breadcrumbs={[
          { label: t("title"), href: `/${locale}/notifications` },
          { label: t("navAutomations"), href: `/${locale}/notifications/automations` },
          { label: isEdit ? name || t("automationEditTitle") : t("automationCreateTitle") },
        ]}
        actions={
          isEdit && existing ? (
            <StatusPill
              variant={
                existing.status === "active"
                  ? "success"
                  : existing.status === "paused"
                    ? "warning"
                    : "neutral"
              }
            >
              {t(`automationStatuses.${existing.status}`)}
            </StatusPill>
          ) : null
        }
      />

      <NotificationWizardStepper
        steps={wizardSteps}
        currentStepId={step}
        completedStepIds={completedSteps}
      />

      <Card className="mt-4 rounded-xl border-border shadow-sm">
        <CardContent className="space-y-3 p-4">
          {step === "trigger" ? (
            <>
              <div className="space-y-1">
                <RequiredLabel required>{t("fieldName")}</RequiredLabel>
                <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <RequiredLabel>{t("fieldDescription")}</RequiredLabel>
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1">
                <RequiredLabel required>{t("fieldTrigger")}</RequiredLabel>
                <Select
                  value={triggerType}
                  onValueChange={(v) => {
                    const next = v as NotificationAutomationTrigger;
                    setTriggerType(next);
                    setTriggerConfig(defaultTriggerConfig(next));
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTIFICATION_AUTOMATION_TRIGGERS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {t(`automationTriggers.${item}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <NotificationTriggerFields
                triggerType={triggerType}
                config={triggerConfig}
                onChange={setTriggerConfig}
              />
            </>
          ) : null}

          {step === "audience" ? (
            <NotificationTargetingFields
              targetMode={targetMode}
              zoneIds={zoneIds}
              partnerIds={partnerIds}
              driverIds={driverIds}
              statuses={statuses}
              onTargetModeChange={setTargetMode}
              onZoneIdsChange={setZoneIds}
              onPartnerIdsChange={setPartnerIds}
              onDriverIdsChange={(ids) => setDriverIds(ids)}
              onStatusesChange={setStatuses}
            />
          ) : null}

          {step === "content" ? (
            <>
              <div className="space-y-1">
                <RequiredLabel required>{t("fieldContentSource")}</RequiredLabel>
                <Select value={contentMode} onValueChange={(v) => setContentMode(v as "template" | "inline")}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inline">{t("contentSourceInline")}</SelectItem>
                    <SelectItem value="template">{t("contentSourceTemplate")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {contentMode === "template" ? (
                <div className="space-y-1">
                  <RequiredLabel required>{t("fieldLinkedTemplate")}</RequiredLabel>
                  <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? "")}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={t("selectTemplate")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(templates ?? []).map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <RequiredLabel>{t("fieldCategory")}</RequiredLabel>
                      <Select value={category} onValueChange={(v) => setCategory(v as NotificationCategory)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {NOTIFICATION_CATEGORIES.map((item) => (
                            <SelectItem key={item} value={item}>
                              {t(`categories.${item}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <RequiredLabel>{t("fieldPriority")}</RequiredLabel>
                      <Select value={priority} onValueChange={(v) => setPriority(v as NotificationPriority)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {NOTIFICATION_PRIORITIES.map((item) => (
                            <SelectItem key={item} value={item}>
                              {t(`priorities.${item}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <RequiredLabel required>{t("fieldTitleTemplate")}</RequiredLabel>
                    <Input className="h-9" value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <RequiredLabel required>{t("fieldBodyTemplate")}</RequiredLabel>
                    <Textarea rows={4} value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} />
                  </div>
                  <NotificationActionFields
                    actionType={actionType}
                    fields={actionFields}
                    onActionTypeChange={(next) => {
                      setActionType(next);
                      setActionFields(parseActionFields(next, {}));
                    }}
                    onFieldChange={(key, value) =>
                      setActionFields((prev) => ({ ...prev, [key]: value }))
                    }
                  />
                </>
              )}
            </>
          ) : null}

          {step === "limits" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <RequiredLabel required>{t("fieldThrottleMinutes")}</RequiredLabel>
                <Input
                  className="h-9"
                  type="number"
                  min={1}
                  value={throttleMinutes}
                  onChange={(e) => setThrottleMinutes(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <RequiredLabel required>{t("fieldCooldownMinutes")}</RequiredLabel>
                <Input
                  className="h-9"
                  type="number"
                  min={1}
                  value={cooldownMinutes}
                  onChange={(e) => setCooldownMinutes(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <RequiredLabel>{t("fieldMaxRetries")}</RequiredLabel>
                <Input
                  className="h-9"
                  type="number"
                  min={0}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {step === "review" ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="font-semibold">{name || "—"}</p>
                <p className="text-muted-foreground">{description || t("noDescription")}</p>
              </div>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("fieldTrigger")}</dt>
                  <dd>{t(`automationTriggers.${triggerType}`)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("targetMode")}</dt>
                  <dd>{t(`targetModes.${targetMode}`)}</dd>
                </div>
              </dl>
              {!canActivate ? (
                <p className="text-sm text-destructive">{t("errors.automationNotReady")}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isEdit && runs?.length ? (
        <AppListCard title={t("automationRunHistory")} className="mt-4">
          <CardContent className="space-y-2 p-4">
            {runs.slice(0, 5).map((run) => (
              <div key={String(run.id)} className="rounded-lg border border-border px-3 py-2 text-sm">
                <p className="font-medium capitalize">{String(run.status)}</p>
                <p className="text-xs text-muted-foreground">
                  {t("automationRunStats", {
                    matched: Number(run.matched_count ?? 0),
                    sent: Number(run.sent_count ?? 0),
                    failed: Number(run.failed_count ?? 0),
                  })}
                </p>
              </div>
            ))}
          </CardContent>
        </AppListCard>
      ) : null}

      <AppModalFooter
        asPage
        title={isEdit ? t("automationEditTitle") : t("automationCreateTitle")}
        subtitle={t("automationBuilderFooterHint")}
      >
        <Link
          href={`/${locale}/notifications/automations`}
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-xs hover:bg-accent"
        >
          {t("cancel")}
        </Link>
        {step !== "trigger" ? (
          <Button variant="outline" className="h-9 cursor-pointer" disabled={pending} onClick={goBack}>
            <ArrowLeft className="size-4" />
            {t("wizardBack")}
          </Button>
        ) : null}
        {step !== "review" ? (
          <Button className="h-9 cursor-pointer" disabled={pending || !canProceed} onClick={goNext}>
            {t("wizardNext")}
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
        {canManage && isEdit && existing?.status !== "active" ? (
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            disabled={pending || !canActivate}
            onClick={() => handleStatusChange("active")}
          >
            <Play className="size-4" />
            {t("activateAutomation")}
          </Button>
        ) : null}
        {canManage && isEdit && existing?.status === "active" ? (
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            disabled={pending}
            onClick={() => handleStatusChange("paused")}
          >
            <Pause className="size-4" />
            {t("pauseAutomation")}
          </Button>
        ) : null}
        {canManage ? (
          <Button className="h-9 cursor-pointer" disabled={pending} onClick={handleSave}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("saveAutomation")}
          </Button>
        ) : null}
      </AppModalFooter>
    </AppPage>
  );
}
