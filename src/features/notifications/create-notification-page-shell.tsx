"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Save, Send, ShieldOff } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { AppFormSection } from "@/components/app";
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
import { dispatchToastCopy } from "./dispatch-toast";
import { useAuth } from "@/contexts/auth-context";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
} from "./constants";
import { previewPayloadSchema, buildActionPayload } from "./payload-contract";
import { resolveScreenshotRestricted } from "./screenshot-restriction";
import {
  buildMediaFromKeys,
  NotificationMediaFields,
} from "./notification-media-fields";
import {
  dispatchNotificationCampaign,
  saveNotificationCampaign,
  scheduleNotificationCampaign,
  submitNotificationForApproval,
} from "./notifications-actions";
import { useNotificationTemplates } from "./use-notifications";
import {
  buildActionParams,
  NotificationActionFields,
  parseActionFields,
  resolveActionFromFields,
} from "./notification-action-fields";
import { RequiredLabel } from "./notification-form-primitives";
import { NotificationTargetingFields } from "./notification-targeting-fields";
import { NotificationMobilePreview } from "./notification-mobile-preview";
import { resolveImportPreviewText } from "./notification-import-panel";
import type { NotificationDriverOption } from "./notification-driver-picker";
import { NotificationWizardStepper } from "./notification-wizard-stepper";
import { invalidateNotificationCaches } from "./invalidate-notification-caches";
import {
  buildTargetSpec,
  campaignNeedsApproval,
  getAudienceStepBlockReason,
  isActionStepValid,
  isAudienceStepValid,
  isContentStepValid,
  isDeliveryStepValid,
  type WizardStepId,
} from "./notification-validation";
import type {
  NotificationActionType,
  NotificationCategory,
  NotificationImportSpec,
  NotificationPriority,
  TargetSpec,
} from "./types";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const STEPS: WizardStepId[] = ["audience", "content", "action", "delivery", "review"];

export function CreateNotificationPageShell() {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const router = useRouter();
  const auth = useAuth();
  const canManage = auth.can("notifications.manage");
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStepId>("audience");
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<NotificationCategory>("announcement");
  const [priority, setPriority] = useState<NotificationPriority>("normal");
  const [targetMode, setTargetMode] = useState<TargetSpec["mode"]>("all");
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [driverIds, setDriverIds] = useState<string[]>([]);
  const [driverOptions, setDriverOptions] = useState<NotificationDriverOption[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [importSpec, setImportSpec] = useState<NotificationImportSpec | null>(null);
  const [importPreviewRow, setImportPreviewRow] = useState(0);
  const [actionType, setActionType] = useState<NotificationActionType>("open_screen");
  const [actionFields, setActionFields] = useState<Record<string, string>>({
    preset: "open_home",
    screen: "home",
  });
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [trackEngagement, setTrackEngagement] = useState(true);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [importOkCount, setImportOkCount] = useState<number | null>(null);
  const [bannerObjectKey, setBannerObjectKey] = useState<string | null>(null);
  const [pushImageObjectKey, setPushImageObjectKey] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  /** null = inherit, true = force on, false = force off */
  const [screenshotOverride, setScreenshotOverride] = useState<boolean | null>(null);

  const { data: templates } = useNotificationTemplates();
  const selectedTemplate = useMemo(
    () => templates?.find((tpl) => tpl.id === templateId) ?? null,
    [templates, templateId],
  );
  const resolvedScreenshotRestricted = useMemo(
    () =>
      resolveScreenshotRestricted(
        screenshotOverride,
        selectedTemplate?.screenshot_restricted ?? false,
      ),
    [screenshotOverride, selectedTemplate?.screenshot_restricted],
  );

  const campaignMedia = useMemo(
    () => buildMediaFromKeys({ bannerObjectKey, imageObjectKey: pushImageObjectKey }),
    [bannerObjectKey, pushImageObjectKey],
  );

  const targetSpec = useMemo(
    () => buildTargetSpec({ targetMode, zoneIds, partnerIds, groupIds, driverIds, statuses }),
    [targetMode, zoneIds, partnerIds, groupIds, driverIds, statuses],
  );

  const previewTitleBody = useMemo(() => {
    if (targetMode === "import" && importSpec?.rows[importPreviewRow]) {
      const row = importSpec.rows[importPreviewRow]!;
      return {
        title: resolveImportPreviewText(title, row),
        body: resolveImportPreviewText(body, row),
      };
    }
    return { title, body };
  }, [targetMode, importSpec, importPreviewRow, title, body]);

  const resolvedAction = useMemo(() => resolveActionFromFields(actionFields), [actionFields]);
  const actionParams = resolvedAction.actionParams;

  const payloadPreview = useMemo(
    () =>
      previewPayloadSchema(
        buildActionPayload({ actionType: resolvedAction.actionType, actionParams }),
        campaignMedia,
        resolvedScreenshotRestricted,
      ),
    [resolvedAction.actionType, actionParams, campaignMedia, resolvedScreenshotRestricted],
  );

  const needsApproval = campaignNeedsApproval({ category, priority, targetMode });

  const audienceInput = useMemo(
    () => ({
      targetMode,
      zoneIds,
      partnerIds,
      groupIds,
      driverIds,
      statuses,
      importSpec,
      audienceCount,
      importOkCount,
    }),
    [
      targetMode,
      zoneIds,
      partnerIds,
      groupIds,
      driverIds,
      statuses,
      importSpec,
      audienceCount,
      importOkCount,
    ],
  );

  const completedSteps = useMemo(() => {
    const currentIdx = STEPS.indexOf(step);
    return STEPS.slice(0, currentIdx).filter((stepId) => {
      if (stepId === "audience") return isAudienceStepValid(audienceInput);
      if (stepId === "content") return isContentStepValid(title, body);
      if (stepId === "action") return isActionStepValid();
      if (stepId === "delivery") return isDeliveryStepValid(scheduleMode, scheduledFor);
      return false;
    });
  }, [step, audienceInput, title, body, scheduleMode, scheduledFor]);

  const canProceed =
    step === "audience"
      ? isAudienceStepValid(audienceInput)
      : step === "content"
        ? isContentStepValid(title, body)
        : step === "action"
          ? isActionStepValid()
          : step === "delivery"
            ? isDeliveryStepValid(scheduleMode, scheduledFor)
            : true;

  const audienceBlockReason =
    step === "audience" && !canProceed ? getAudienceStepBlockReason(audienceInput) : null;

  const canSubmit =
    completedSteps.includes("audience") &&
    completedSteps.includes("content") &&
    completedSteps.includes("delivery");

  function buildInput() {
    const scheduledIso =
      scheduleMode === "later" && scheduledFor.trim()
        ? new Date(scheduledFor).toISOString()
        : null;
    return {
      title,
      body,
      category,
      priority,
      templateId,
      targetSpec,
      importSpec: targetMode === "import" ? importSpec ?? undefined : undefined,
      trackEngagement,
      actionType: resolvedAction.actionType,
      actionParams,
      media: campaignMedia,
      screenshotRestrictedOverride: screenshotOverride,
      scheduleSpec: {
        mode: scheduleMode,
        scheduled_for: scheduledIso,
      },
    };
  }

  function resolveErrorMessage(error: string) {
    switch (error) {
      case "not_authorized":
      case "invalid_input":
      case "missing_content":
      case "empty_recipients":
      case "approval_required":
      case "empty_audience":
      case "dispatch_failed":
      case "invalid_schedule":
        return t(`errors.${error}`);
      default:
        return t("errors.saveFailed");
    }
  }

  function goNext() {
    if (!canProceed) return;
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]!);
  }

  function goBack() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]!);
  }

  function handleSaveDraft() {
    if (!isContentStepValid(title, body)) {
      toast.error(t("errors.missing_content"));
      setStep("content");
      return;
    }
    startTransition(async () => {
      const result = await saveNotificationCampaign(buildInput());
      if ("error" in result) {
        toast.error(resolveErrorMessage(result.error));
        return;
      }
      await invalidateNotificationCaches(queryClient, { campaignId: result.id });
      toast.success(t("savedDraft"));
      router.push(`/${locale}/notifications/${result.id}`);
    });
  }

  function handleSubmit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const input = buildInput();
      const saved = await saveNotificationCampaign(input);
      if ("error" in saved) {
        toast.error(resolveErrorMessage(saved.error));
        return;
      }
      await invalidateNotificationCaches(queryClient, { campaignId: saved.id });
      if (scheduleMode === "now") {
        if (needsApproval && !auth.can("notifications.approve")) {
          const submitted = await submitNotificationForApproval(saved.id);
          if ("error" in submitted) {
            toast.error(t("errors.saveFailed"));
            router.push(`/${locale}/notifications/${saved.id}`);
            return;
          }
          toast.success(t("submittedForApproval"));
          router.push(`/${locale}/notifications/${saved.id}`);
          return;
        }
        const sent = await dispatchNotificationCampaign(saved.id);
        if ("error" in sent) {
          toast.error(resolveErrorMessage(sent.error));
          router.push(`/${locale}/notifications/${saved.id}`);
          return;
        }
        await invalidateNotificationCaches(queryClient, { campaignId: saved.id });
        const copy = dispatchToastCopy(sent);
        toast[copy.kind](
          t(copy.key, { sent: sent.sent, failed: sent.failed, skipped: sent.skipped }),
        );
      } else {
        const scheduled = await scheduleNotificationCampaign(saved.id);
        if ("error" in scheduled) {
          toast.error(t("errors.saveFailed"));
          router.push(`/${locale}/notifications/${saved.id}`);
          return;
        }
        await invalidateNotificationCaches(queryClient, { campaignId: saved.id });
        toast.success(t("scheduledSuccess"));
      }
      router.push(`/${locale}/notifications/${saved.id}`);
    });
  }

  const wizardSteps = STEPS.map((id) => ({
    id,
    label: t(`wizardSteps.${id}`),
  }));

  return (
    <AppPage narrow>
      <AppPageHeader
        title={t("createTitle")}
        description={t("createSubtitle")}
        breadcrumbs={[
          { label: t("title"), href: `/${locale}/notifications` },
          { label: t("createTitle") },
        ]}
      />

      <NotificationWizardStepper
        steps={wizardSteps}
        currentStepId={step}
        completedStepIds={completedSteps}
      />

      <AppFormSection title={t(`wizardSteps.${step}`)} className="mt-4">
        <div className="space-y-4">
          {step === "audience" ? (
            <NotificationTargetingFields
              targetMode={targetMode}
              zoneIds={zoneIds}
              partnerIds={partnerIds}
              groupIds={groupIds}
              driverIds={driverIds}
              driverOptions={driverOptions}
              statuses={statuses}
              importSpec={importSpec}
              titleTemplate={title}
              bodyTemplate={body}
              onTargetModeChange={(mode) => {
                setTargetMode(mode);
                setAudienceCount(null);
                setImportOkCount(null);
              }}
              onZoneIdsChange={setZoneIds}
              onPartnerIdsChange={setPartnerIds}
              onGroupIdsChange={setGroupIds}
              onDriverIdsChange={(ids, options) => {
                setDriverIds(ids);
                if (options) setDriverOptions(options);
              }}
              onStatusesChange={setStatuses}
              onImportSpecChange={setImportSpec}
              onImportPreviewRowChange={setImportPreviewRow}
              onImportPreviewStatsChange={(stats) => setImportOkCount(stats?.okCount ?? null)}
              onAudienceCountChange={setAudienceCount}
            />
          ) : null}
          {step === "audience" && audienceBlockReason ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              {t(`wizardAudienceBlock.${audienceBlockReason}`)}
            </p>
          ) : null}

          {step === "content" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
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
                <RequiredLabel required>{t("fieldTitle")}</RequiredLabel>
                <Input className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <RequiredLabel required>{t("fieldBody")}</RequiredLabel>
                <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("fieldLinkedTemplate")}</Label>
                <Select
                  value={templateId ?? "__none__"}
                  onValueChange={(v) => setTemplateId(v === "__none__" ? null : v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={t("selectTemplateOptional")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("noTemplate")}</SelectItem>
                    {(templates ?? []).map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canManage ? (
                <div className="space-y-1.5">
                  <Label>{t("fieldScreenshotRestricted")}</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <SegmentOption
                      selected={screenshotOverride === null}
                      onClick={() => setScreenshotOverride(null)}
                    >
                      {t("screenshotInherit")}
                    </SegmentOption>
                    <SegmentOption
                      selected={screenshotOverride === true}
                      onClick={() => setScreenshotOverride(true)}
                      variant="success"
                    >
                      {t("screenshotForceOn")}
                    </SegmentOption>
                    <SegmentOption
                      selected={screenshotOverride === false}
                      onClick={() => setScreenshotOverride(false)}
                    >
                      {t("screenshotForceOff")}
                    </SegmentOption>
                  </div>
                  <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <ShieldOff className="size-3 shrink-0" aria-hidden />
                    {resolvedScreenshotRestricted
                      ? t("screenshotWillRestrict")
                      : t("screenshotWontRestrict")}
                  </p>
                </div>
              ) : null}
              <NotificationMediaFields
                bannerObjectKey={bannerObjectKey}
                imageObjectKey={pushImageObjectKey}
                onBannerChange={setBannerObjectKey}
                onImageChange={setPushImageObjectKey}
              />
              </div>
              <NotificationMobilePreview
                title={previewTitleBody.title}
                body={previewTitleBody.body}
                category={category}
                bannerObjectKey={bannerObjectKey}
                pushImageObjectKey={pushImageObjectKey}
                actionType={resolvedAction.actionType}
                actionFields={actionFields}
              />
            </div>
          ) : null}

          {step === "action" ? (
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
          ) : null}

          {step === "delivery" ? (
            <>
              <div className="space-y-1">
                <RequiredLabel required>{t("fieldScheduleMode")}</RequiredLabel>
                <Select value={scheduleMode} onValueChange={(v) => setScheduleMode(v as "now" | "later")}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="now">{t("scheduleNow")}</SelectItem>
                    <SelectItem value="later">{t("scheduleLater")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scheduleMode === "later" ? (
                <div className="space-y-1">
                  <RequiredLabel required>{t("fieldScheduledFor")}</RequiredLabel>
                  <Input
                    className="h-9"
                    type="datetime-local"
                    value={scheduledFor}
                    onChange={(e) => setScheduledFor(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("scheduleFutureHint")}</p>
                </div>
              ) : null}
              {needsApproval ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                  {t("approvalNotice")}
                </p>
              ) : null}
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <Label htmlFor="track-engagement">{t("fieldTrackEngagement")}</Label>
                  <p className="text-xs text-muted-foreground">{t("fieldTrackEngagementHint")}</p>
                </div>
                <Switch
                  id="track-engagement"
                  checked={trackEngagement}
                  onCheckedChange={setTrackEngagement}
                />
              </div>
            </>
          ) : null}

          {step === "review" ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                <p>
                  <span className="font-medium">{t("targetMode")}:</span>{" "}
                  {t(`targetModes.${targetMode}`)}
                </p>
                <p>
                  <span className="font-medium">{t("fieldScheduleMode")}:</span>{" "}
                  {scheduleMode === "now" ? t("scheduleNow") : t("scheduleLater")}
                </p>
                {scheduleMode === "later" ? (
                  <p>
                    <span className="font-medium">{t("fieldScheduledFor")}:</span> {scheduledFor}
                  </p>
                ) : null}
              </div>
              <NotificationMobilePreview
                title={previewTitleBody.title}
                body={previewTitleBody.body}
                category={category}
                bannerObjectKey={bannerObjectKey}
                pushImageObjectKey={pushImageObjectKey}
                actionType={resolvedAction.actionType}
                actionFields={actionFields}
              />
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-accent">{t("previewPayload")}</p>
                <pre className="mt-2 overflow-x-auto text-xs">{payloadPreview}</pre>
              </div>
            </div>
          ) : null}
        </div>
      </AppFormSection>

      <AppModalFooter asPage title={t("createTitle")} subtitle={t("createFooterHint")}>
        <Link
          href={`/${locale}/notifications`}
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-xs hover:bg-accent"
        >
          {t("cancel")}
        </Link>
        {step !== "audience" ? (
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
        ) : (
          <>
            <Button
              variant="outline"
              className="h-9 cursor-pointer"
              disabled={pending || !canSubmit}
              onClick={handleSaveDraft}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("saveDraft")}
            </Button>
            <Button
              className="h-9 cursor-pointer"
              disabled={pending || !canSubmit}
              onClick={handleSubmit}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {scheduleMode === "now" ? t("sendNow") : t("scheduleSend")}
            </Button>
          </>
        )}
      </AppModalFooter>
    </AppPage>
  );
}
