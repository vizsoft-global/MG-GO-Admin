"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Archive, Loader2, Save } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabBar } from "@/components/dashboard/tab-bar";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import {
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
} from "./constants";
import { previewPayloadSchema, buildActionPayload } from "./payload-contract";
import {
  archiveNotificationTemplate,
  saveNotificationTemplate,
  updateNotificationTemplate,
} from "./notifications-actions";
import { useNotificationTemplate } from "./use-notifications";
import type { NotificationActionType, NotificationCategory, NotificationPriority } from "./types";

type SectionId = "content" | "variables" | "action" | "preview";

export function TemplateBuilderPageShell({ templateId }: { templateId?: string }) {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const router = useRouter();
  const auth = useAuth();
  const canManage = auth.can("notifications.manage");
  const isEdit = Boolean(templateId);
  const [section, setSection] = useState<SectionId>("content");
  const [pending, startTransition] = useTransition();

  const { data: existing, isLoading } = useNotificationTemplate(templateId ?? null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<NotificationCategory>("announcement");
  const [priority, setPriority] = useState<NotificationPriority>("normal");
  const [titleTemplate, setTitleTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [variablesJson, setVariablesJson] = useState("[]");
  const [actionType, setActionType] = useState<NotificationActionType>("open_screen");
  const [actionParamsJson, setActionParamsJson] = useState('{"screen":"home"}');

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setDescription(existing.description ?? "");
    setCategory(existing.category);
    setPriority(existing.priority);
    setTitleTemplate(existing.title_template);
    setBodyTemplate(existing.body_template);
    setVariablesJson(JSON.stringify(existing.variable_schema ?? [], null, 2));
    setActionType(existing.action_type);
    setActionParamsJson(JSON.stringify(existing.action_params ?? {}, null, 2));
  }, [existing]);

  const actionParams = useMemo(() => {
    try {
      return JSON.parse(actionParamsJson) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [actionParamsJson]);

  const variableSchema = useMemo(() => {
    try {
      return JSON.parse(variablesJson) as unknown[];
    } catch {
      return [];
    }
  }, [variablesJson]);

  const payloadPreview = useMemo(
    () =>
      previewPayloadSchema(
        buildActionPayload({ actionType, actionParams }),
      ),
    [actionType, actionParams],
  );

  function buildInput() {
    return {
      name,
      description: description || null,
      category,
      priority,
      titleTemplate,
      bodyTemplate,
      variableSchema,
      actionType,
      actionParams,
    };
  }

  function handleSave() {
    if (!name.trim() || !titleTemplate.trim() || !bodyTemplate.trim()) {
      toast.error(t("errors.invalid_input"));
      setSection("content");
      return;
    }
    try {
      JSON.parse(variablesJson);
      JSON.parse(actionParamsJson);
    } catch {
      toast.error(t("errors.invalid_json"));
      return;
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateNotificationTemplate(templateId!, buildInput())
        : await saveNotificationTemplate(buildInput());
      if ("error" in result) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      toast.success(isEdit ? t("templateUpdated") : t("templateCreated"));
      router.push(`/${locale}/notifications/templates/${result.id}`);
    });
  }

  function handleArchive() {
    if (!templateId) return;
    startTransition(async () => {
      const result = await archiveNotificationTemplate(templateId);
      if ("error" in result) {
        toast.error(t("errors.saveFailed"));
        return;
      }
      toast.success(t("templateArchived"));
      router.push(`/${locale}/notifications/templates`);
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
    return <p className="py-12 text-center text-sm text-muted-foreground">{t("templateNotFound")}</p>;
  }

  return (
    <AppPage narrow>
      <AppPageHeader
        title={isEdit ? t("templateEditTitle") : t("templateCreateTitle")}
        description={t("templateBuilderSubtitle")}
        breadcrumbs={[
          { label: t("title"), href: `/${locale}/notifications` },
          { label: t("navTemplates"), href: `/${locale}/notifications/templates` },
          { label: isEdit ? name || t("templateEditTitle") : t("templateCreateTitle") },
        ]}
      />

      <TabBar
        items={[
          { id: "content", label: t("sectionContent") },
          { id: "variables", label: t("sectionVariables") },
          { id: "action", label: t("sectionAction") },
          { id: "preview", label: t("sectionPreview") },
        ]}
        activeId={section}
        onSelect={(id) => setSection(id as SectionId)}
      />

      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="space-y-3 p-4">
          {section === "content" ? (
            <>
              <div className="space-y-1">
                <Label>{t("fieldName")}</Label>
                <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("fieldDescription")}</Label>
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t("fieldCategory")}</Label>
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
                  <Label>{t("fieldPriority")}</Label>
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
                <Label>{t("fieldTitleTemplate")}</Label>
                <Input
                  className="h-9"
                  value={titleTemplate}
                  onChange={(e) => setTitleTemplate(e.target.value)}
                  placeholder={t("templatePlaceholderHint")}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("fieldBodyTemplate")}</Label>
                <Textarea
                  rows={4}
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  placeholder={t("templatePlaceholderHint")}
                />
              </div>
            </>
          ) : null}

          {section === "variables" ? (
            <>
              <p className="text-sm text-muted-foreground">{t("variablesHint")}</p>
              <div className="space-y-1">
                <Label>{t("fieldVariableSchema")}</Label>
                <Textarea
                  rows={10}
                  className="font-mono text-xs"
                  value={variablesJson}
                  onChange={(e) => setVariablesJson(e.target.value)}
                />
              </div>
            </>
          ) : null}

          {section === "action" ? (
            <>
              <div className="space-y-1">
                <Label>{t("fieldActionType")}</Label>
                <Select value={actionType} onValueChange={(v) => setActionType(v as NotificationActionType)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTIFICATION_ACTION_TYPES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {t(`actionTypes.${item}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("fieldActionParams")}</Label>
                <Textarea
                  rows={6}
                  className="font-mono text-xs"
                  value={actionParamsJson}
                  onChange={(e) => setActionParamsJson(e.target.value)}
                />
              </div>
            </>
          ) : null}

          {section === "preview" ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-accent">{t("previewMessage")}</p>
                <p className="mt-1 text-sm font-semibold">
                  {titleTemplate || t("previewTitlePlaceholder")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {bodyTemplate || t("previewBodyPlaceholder")}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-accent">{t("previewPayload")}</p>
                <pre className="mt-2 overflow-x-auto text-xs">{payloadPreview}</pre>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AppModalFooter
        asPage
        title={isEdit ? t("templateEditTitle") : t("templateCreateTitle")}
        subtitle={t("templateBuilderFooterHint")}
      >
        <Link
          href={`/${locale}/notifications/templates`}
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-xs hover:bg-accent"
        >
          {t("cancel")}
        </Link>
        {canManage && isEdit ? (
          <Button
            variant="outline"
            className="h-9 cursor-pointer text-destructive"
            disabled={pending}
            onClick={handleArchive}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
            {t("archiveTemplate")}
          </Button>
        ) : null}
        {canManage ? (
          <Button className="h-9 cursor-pointer" disabled={pending} onClick={handleSave}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("saveTemplate")}
          </Button>
        ) : null}
      </AppModalFooter>
    </AppPage>
  );
}
