"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Info, Lock, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatPct } from "@/lib/format/percent";
import { cn } from "@/lib/utils";
import { fetchPortalConfigs, savePortalConfig } from "./portal-config-actions";
import {
  PORTAL_DOC_KEYS,
  PORTAL_SECTION_KEYS,
  emptyPortalConfig,
  type PortalConfig,
  type PortalDocKey,
  type PortalSectionKey,
  type PortalUserRole,
} from "./portal-config";
import { fetchPortalDirectory, type PortalDirectoryRow } from "./portal-v2-actions";

const SELECT = "h-9 min-h-9 border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]";
const FIELD = "h-9 border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]";
const HINT = "mt-1 block text-[11px] leading-4 text-[var(--text-muted)]";
const PROJECT_KEYS = ["keeta", "americana", "unassigned"] as const;

type T = ReturnType<typeof useTranslations<"pages.clientPortalV2">>;

function projectLabel(key: string, t: ReturnType<typeof useTranslations<"pages.operationsDashboardV2">>): string {
  if (key === "americana") return t("projectAmericana");
  if (key === "unassigned") return t("projectUnassigned");
  if (key === "keeta") return t("projectKeeta");
  return "—";
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1 text-xs font-medium text-[var(--text-secondary)]">
      <span>
        {label}
        {required ? <span className="text-[var(--accent-rust)]"> *</span> : null}
      </span>
      {children}
      {hint ? <span className={HINT}>{hint}</span> : null}
    </label>
  );
}

function SectionCard({ index, title, subtitle, children }: { index: number; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
      <header className="flex items-start gap-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--selected-navy)] text-[11px] font-semibold text-white">
          {index}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-bold leading-6 text-[var(--text-primary)]">{title}</h2>
          <p className="text-[12px] text-[var(--text-secondary)]">{subtitle}</p>
        </div>
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  chip,
  tone = "neutral",
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  chip?: string;
  tone?: "neutral" | "risk" | "sensitive";
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
          {label}
          {chip ? (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                tone === "risk"
                  ? "bg-[var(--status-absent-bg)] text-[var(--status-absent-fg)]"
                  : "bg-[var(--status-sick-bg)] text-[var(--status-sick-fg)]",
              )}
            >
              {chip}
            </span>
          ) : null}
        </p>
        <p className="text-[11px] text-[var(--text-secondary)]">{hint}</p>
      </div>
      <Switch tone="portal" checked={checked} onCheckedChange={(next) => onChange(next === true)} />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] py-2 last:border-b-0">
      <dt className="text-[var(--text-secondary)]">{label}</dt>
      <dd className="min-w-0 truncate text-end font-medium text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

export function NewPortalV2({ initial, initialProject }: { initial: PortalConfig | null; initialProject?: string }) {
  const t = useTranslations("pages.clientPortalV2");
  const tOps = useTranslations("pages.operationsDashboardV2");
  const router = useRouter();
  const [config, setConfig] = useState<PortalConfig>(
    () =>
      initial ??
      {
        ...emptyPortalConfig(initialProject ?? ""),
        clientName: initialProject ? projectLabel(initialProject, tOps) : "",
      },
  );
  const [directory, setDirectory] = useState<PortalDirectoryRow[]>([]);
  const [others, setOthers] = useState<PortalConfig[]>([]);
  const [reviewed, setReviewed] = useState(Boolean(initial?.updatedAt));
  const [docsTouched, setDocsTouched] = useState(Boolean(initial?.updatedAt));
  const [saving, setSaving] = useState<"draft" | "active" | null>(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState<PortalUserRole>("admin");
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    void fetchPortalDirectory().then((result) => {
      if (!cancelled) setDirectory(result.rows);
    });
    void fetchPortalConfigs().then((result) => {
      if (!cancelled) setOthers(result.rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const riders = directory.find((row) => row.projectKey === config.projectKey)?.riders ?? 0;
  const sectionsOn = PORTAL_SECTION_KEYS.filter((key) => config.sections[key]).length;
  const docsOn = PORTAL_DOC_KEYS.filter((key) => config.documents[key]).length;
  const contractFill = config.contractedHeadcount > 0 ? (riders / config.contractedHeadcount) * 100 : 0;

  const sectionRows: { key: PortalSectionKey; label: string; hint: string; chip?: string; tone?: "sensitive" }[] = [
    { key: "riderStatus", label: t("riderStatus"), hint: t("riderStatusHint") },
    { key: "leavePlan", label: t("leavePlan"), hint: t("leavePlanHint") },
    { key: "newRiders", label: t("newRiders"), hint: t("newRidersHint") },
    { key: "contractFill", label: t("contractFill"), hint: t("contractFillHint") },
    { key: "onLeaveNow", label: t("onLeaveNow"), hint: t("onLeaveNowHint") },
    { key: "turnover", label: t("turnover"), hint: t("turnoverHint"), chip: t("sensitive"), tone: "sensitive" },
    { key: "employeesDocs", label: t("employeesDocs"), hint: t("employeesDocsHint") },
  ];

  const documentRows: { key: PortalDocKey; label: string; locked?: boolean }[] = [
    { key: "civilId", label: t("docCivilId") },
    { key: "drivingLicence", label: t("docDrivingLicence") },
    { key: "vehicleRegistration", label: t("docVehicleRegistration") },
    { key: "vehicleInsurance", label: t("docVehicleInsurance") },
    { key: "healthCertificate", label: t("docHealthCertificate") },
    { key: "clientOnboarding", label: t("docClientOnboarding") },
    { key: "passport", label: t("docPassport") },
    { key: "employmentContract", label: t("docEmploymentContract"), locked: true },
    { key: "salaryBank", label: t("docSalaryBank"), locked: true },
  ];

  const steps = [
    { key: "client", label: t("stepClientDetails"), done: Boolean(config.clientName.trim() && config.accountManager.trim() && config.contractedHeadcount > 0) },
    { key: "projects", label: t("stepProjects"), done: Boolean(config.projectKey) },
    { key: "visibility", label: t("stepVisibility"), done: reviewed },
    { key: "documents", label: t("stepDocuments"), done: docsTouched },
    { key: "users", label: t("stepUsers"), done: config.users.length > 0 },
  ];
  const currentStep = Math.max(0, steps.findIndex((step) => !step.done));
  const checks = [
    { label: t("checkClientDetails"), done: steps[0]?.done ?? false },
    { label: t("checkProject"), done: steps[1]?.done ?? false },
    { label: t("checkVisibility"), done: steps[2]?.done ?? false },
    { label: t("checkUser"), done: steps[4]?.done ?? false },
  ];

  const linkedTo = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of others) {
      if (row.projectKey === config.projectKey) continue;
      map.set(row.projectKey, row.clientName);
    }
    return map;
  }, [others, config.projectKey]);

  const patch = (next: Partial<PortalConfig>) => setConfig((current) => ({ ...current, ...next }));

  function toggleSection(key: PortalSectionKey) {
    setReviewed(true);
    setConfig((current) => ({ ...current, sections: { ...current.sections, [key]: !current.sections[key] } }));
  }

  function toggleDocument(key: PortalDocKey) {
    setDocsTouched(true);
    setConfig((current) => ({ ...current, documents: { ...current.documents, [key]: !current.documents[key] } }));
  }

  function addUser() {
    const email = userEmail.trim().toLowerCase();
    if (!email || !userName.trim()) return;
    if (config.users.some((user) => user.email.toLowerCase() === email)) return;
    setConfig((current) => ({
      ...current,
      users: [...current.users, { id: email, name: userName.trim(), email, role: userRole }],
    }));
    setUserName("");
    setUserEmail("");
    setUserRole("admin");
  }

  async function persist(status: "draft" | "active") {
    if (!config.clientName.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    if (!config.projectKey) {
      toast.error(t("projectRequired"));
      return;
    }
    setSaving(status);
    const result = await savePortalConfig({ config: { ...config, status }, status });
    setSaving(null);
    if (result.error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(status === "active" ? t("published") : t("savedDraft"));
    router.push("/client-portal-v2/clients");
  }

  function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 180 * 1024) {
      toast.error(t("logoTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") patch({ logoUrl: reader.result });
    };
    reader.readAsDataURL(file);
  }

  const draft = config.status !== "active";


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <Link
          href="/client-portal-v2/clients"
          aria-label={t("backToClients")}
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)]"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span>{t("breadcrumbApps")}</span>
            <span aria-hidden>›</span>
            <span>{t("breadcrumbSelf")}</span>
            <span aria-hidden>›</span>
            <span className="text-[var(--text-secondary)]">{t("newPortalTitle")}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[24px] font-bold leading-8 text-[var(--text-primary)]">{t("newPortalTitle")}</h1>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                draft
                  ? "bg-[var(--surface-subtle)] text-[var(--text-secondary)]"
                  : "bg-[var(--status-working-bg)] text-[var(--status-working-fg)]",
              )}
            >
              {draft ? t("createdBadge") : t("statusActive")}
            </span>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">{t("newPortalSubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:pt-5">
          <Button variant="portal-secondary" className="h-9 cursor-pointer" render={<Link href="/client-portal-v2/clients" />}>
            {t("cancel")}
          </Button>
          <Button variant="portal-secondary" className="h-9 cursor-pointer" disabled={saving != null} onClick={() => void persist("draft")}>
            {t("saveDraft")}
          </Button>
          <Button variant="portal" className="h-9 cursor-pointer" disabled={saving != null} onClick={() => void persist("active")}>
            {t("publish")}
          </Button>
        </div>
      </div>


      <div className="grid items-start gap-4 xl:grid-cols-[236px_minmax(0,1fr)_296px]">
        <aside className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{t("setupTitle")}</p>
          <ol className="mt-2 space-y-0.5">
            {steps.map((step, index) => {
              const active = index === currentStep;
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => refs.current[step.key]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-start",
                      active ? "bg-[#fbeee9]" : "hover:bg-[var(--surface-subtle)]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                        step.done
                          ? "bg-[var(--status-working-fg)] text-white"
                          : active
                            ? "bg-[var(--accent-rust)] text-white"
                            : "border border-[var(--border-default)] text-[var(--text-secondary)]",
                      )}
                    >
                      {step.done ? <Check className="size-3.5" aria-hidden /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold leading-5 text-[var(--text-primary)]">{step.label}</span>
                      <span className="block text-[11px] leading-4 text-[var(--text-secondary)]">
                        {step.done ? t("completed") : active ? t("inProgress") : t("notStarted")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <div className="min-w-0 space-y-4">
          <div ref={(node) => { refs.current.client = node; }}>
            <SectionCard index={1} title={t("clientDetailsTitle")} subtitle={t("clientDetailsSubtitle")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("clientName")} required>
                  <Input className={FIELD} value={config.clientName} onChange={(event) => patch({ clientName: event.target.value })} />
                </Field>
                <Field label={t("clientCode")} hint={t("clientCodeHint")}>
                  <Input className={FIELD} value={config.clientCode} onChange={(event) => patch({ clientCode: event.target.value.toUpperCase() })} />
                </Field>
                <Field label={t("accountManager")} required>
                  <Input className={FIELD} value={config.accountManager} onChange={(event) => patch({ accountManager: event.target.value })} />
                </Field>
                <Field label={t("contractedHeadcount")} required hint={t("contractedHeadcountHint")}>
                  <Input
                    className={FIELD}
                    type="number"
                    min={0}
                    value={config.contractedHeadcount || ""}
                    onChange={(event) => patch({ contractedHeadcount: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Field label={t("contractStart")}>
                  <Input className={FIELD} type="date" openPickerOnFocus={false} value={config.contractStart} onChange={(event) => patch({ contractStart: event.target.value })} />
                </Field>
                <Field label={t("contractEnd")}>
                  <Input className={FIELD} type="date" openPickerOnFocus={false} value={config.contractEnd} onChange={(event) => patch({ contractEnd: event.target.value })} />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-[var(--border-default)] px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--surface-subtle)]">
                  {config.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={config.logoUrl} alt="" className="size-9 object-cover" />
                  ) : (
                    <Upload className="size-4 text-[var(--text-secondary)]" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[var(--text-primary)]">{t("clientLogo")}</p>
                  <p className="text-[11px] text-[var(--text-secondary)]">{t("clientLogoHint")}</p>
                </div>
                <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-[var(--border-default)] px-3 text-[13px] font-medium text-[var(--text-primary)]">
                  {t("upload")}
                  <input type="file" accept="image/png,image/svg+xml,image/jpeg" className="hidden" onChange={(event) => uploadLogo(event.target.files?.[0])} />
                </label>
              </div>
            </SectionCard>
          </div>


          <div ref={(node) => { refs.current.projects = node; }}>
            <SectionCard index={2} title={t("projectsTitle")} subtitle={t("projectsSubtitle")}>
              <div className="space-y-2">
                {PROJECT_KEYS.map((key) => {
                  const linkedClient = linkedTo.get(key);
                  const selected = config.projectKey === key;
                  const ridersHere = directory.find((row) => row.projectKey === key)?.riders ?? 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={Boolean(linkedClient)}
                      onClick={() => patch({ projectKey: key })}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-start",
                        selected ? "border-[var(--accent-rust)]" : "border-[var(--border-default)]",
                        linkedClient ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[var(--surface-subtle)]",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-full border",
                          selected ? "border-[var(--accent-rust)]" : "border-[var(--status-neutral-fg)]",
                        )}
                        aria-hidden
                      >
                        {selected ? <span className="size-2 rounded-full bg-[var(--accent-rust)]" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{projectLabel(key, tOps)}</span>
                        <span className="block text-[11px] text-[var(--text-secondary)]">
                          {t("ridersCount", { count: ridersHere })}
                          {key === "unassigned" ? ` · ${t("notLinked")}` : ""}
                        </span>
                      </span>
                      {selected ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--status-working-fg)]">
                          <span className="size-1.5 rounded-full bg-[var(--status-working-fg)]" aria-hidden />
                          {t("selected")}
                        </span>
                      ) : linkedClient ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)]">
                          <span className="size-1.5 rounded-full bg-[var(--status-neutral-fg)]" aria-hidden />
                          {t("linkedTo", { client: linkedClient })}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </SectionCard>
          </div>

          <div ref={(node) => { refs.current.visibility = node; }}>
            <SectionCard index={3} title={t("visibilityTitle")} subtitle={t("visibilitySubtitle")}>
              <div className="divide-y divide-[var(--border-default)]">
                {sectionRows.map((row) => (
                  <ToggleRow
                    key={row.key}
                    label={row.label}
                    hint={row.hint}
                    chip={row.chip}
                    tone="sensitive"
                    checked={config.sections[row.key]}
                    onChange={() => toggleSection(row.key)}
                  />
                ))}
              </div>
            </SectionCard>
          </div>


          <div ref={(node) => { refs.current.documents = node; }}>
            <SectionCard index={4} title={t("documentsTitle")} subtitle={t("documentsSubtitle")}>
              <p className="text-[12px] font-medium text-[var(--text-secondary)]">{t("documentTypes")}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {documentRows.map((doc) => (
                  <label
                    key={doc.key}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[12px]",
                      doc.locked
                        ? "cursor-not-allowed border-[var(--border-default)] bg-[var(--surface-subtle)] text-[var(--text-muted)]"
                        : "cursor-pointer border-[var(--border-default)] text-[var(--text-primary)]",
                    )}
                  >
                    <Checkbox
                      tone="portal"
                      locked={doc.locked}
                      checked={doc.locked ? false : config.documents[doc.key]}
                      onCheckedChange={doc.locked ? undefined : () => toggleDocument(doc.key)}
                    />
                    <span className="min-w-0 flex-1 truncate">{doc.label}</span>
                    {doc.locked ? <Lock className="size-3 shrink-0" aria-hidden /> : null}
                  </label>
                ))}
              </div>
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("docHiddenNote")}
              </p>
              <div className="mt-3 divide-y divide-[var(--border-default)]">
                <ToggleRow
                  label={t("maskCivilId")}
                  hint={t("maskCivilIdHint")}
                  checked={config.maskCivilId}
                  onChange={(next) => patch({ maskCivilId: next })}
                />
                <ToggleRow
                  label={t("allowDownloads")}
                  hint={t("allowDownloadsHint")}
                  checked={config.allowDownloads}
                  onChange={(next) => patch({ allowDownloads: next })}
                />
                <ToggleRow
                  label={t("allowBulk")}
                  hint={t("allowBulkHint")}
                  chip={t("highRisk")}
                  tone="risk"
                  checked={config.allowBulk}
                  onChange={(next) => patch({ allowBulk: next })}
                />
                <ToggleRow
                  label={t("watermark")}
                  hint={t("watermarkHint")}
                  checked={config.watermark}
                  onChange={(next) => patch({ watermark: next })}
                />
              </div>
            </SectionCard>
          </div>


          <div ref={(node) => { refs.current.users = node; }}>
            <SectionCard index={5} title={t("usersTitle")} subtitle={t("usersSubtitle")}>
              <div className="space-y-2">
                {config.users.map((user) => (
                  <div key={user.id} className="flex flex-wrap items-center gap-2">
                    <Input
                      className={`${FIELD} min-w-32 flex-1`}
                      value={user.name}
                      aria-label={t("userName")}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          users: current.users.map((row) => (row.id === user.id ? { ...row, name: event.target.value } : row)),
                        }))
                      }
                    />
                    <Input
                      className={`${FIELD} min-w-40 flex-1`}
                      type="email"
                      value={user.email}
                      aria-label={t("userEmail")}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          users: current.users.map((row) => (row.id === user.id ? { ...row, email: event.target.value } : row)),
                        }))
                      }
                    />
                    <Select
                      value={user.role}
                      onValueChange={(value) =>
                        setConfig((current) => ({
                          ...current,
                          users: current.users.map((row) =>
                            row.id === user.id ? { ...row, role: value === "viewer" ? "viewer" : "admin" } : row,
                          ),
                        }))
                      }
                    >
                      <SelectTrigger className={`${SELECT} w-32`} aria-label={t("userRole")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                        <SelectItem value="viewer">{t("roleViewer")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      aria-label={t("removeUser")}
                      className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]"
                      onClick={() =>
                        setConfig((current) => ({ ...current, users: current.users.filter((row) => row.id !== user.id) }))
                      }
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input className={`${FIELD} min-w-32 flex-1`} placeholder={t("userName")} value={userName} onChange={(event) => setUserName(event.target.value)} />
                <Input
                  className={`${FIELD} min-w-40 flex-1`}
                  type="email"
                  placeholder={t("userEmail")}
                  value={userEmail}
                  onChange={(event) => setUserEmail(event.target.value)}
                />
                <Select value={userRole} onValueChange={(value) => setUserRole(value === "viewer" ? "viewer" : "admin")}>
                  <SelectTrigger className={`${SELECT} w-32`} aria-label={t("userRole")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                    <SelectItem value="viewer">{t("roleViewer")}</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={addUser}
                  disabled={!userName.trim() || !userEmail.trim()}
                  className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-[var(--accent-rust)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + {t("addAnotherUser")}
                </button>
              </div>
              <div className="mt-3 divide-y divide-[var(--border-default)]">
                <ToggleRow label={t("twoStep")} hint={t("twoStepHint")} checked={config.twoStep} onChange={(next) => patch({ twoStep: next })} />
                <ToggleRow label={t("signOutIdle")} hint={t("signOutIdleHint")} checked={config.idleSignOut} onChange={(next) => patch({ idleSignOut: next })} />
              </div>
            </SectionCard>
          </div>
        </div>


        <aside className="space-y-3 xl:sticky xl:top-4">
          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
            <h2 className="font-display text-[15px] font-bold text-[var(--text-primary)]">{t("summaryTitle")}</h2>
            <dl className="mt-2 text-[12px]">
              <SummaryRow label={t("summaryClient")} value={config.clientName || "—"} />
              <SummaryRow label={t("summaryProjects")} value={config.projectKey ? projectLabel(config.projectKey, tOps) : "—"} />
              <SummaryRow label={t("summaryRiders")} value={String(riders)} />
              <SummaryRow label={t("summaryContractFill")} value={`${formatPct(contractFill)} (${riders} / ${config.contractedHeadcount})`} />
              <SummaryRow label={t("summarySections")} value={`${sectionsOn} / ${PORTAL_SECTION_KEYS.length}`} />
              <SummaryRow label={t("summaryDocTypes")} value={`${docsOn} / ${PORTAL_DOC_KEYS.length}`} />
              <SummaryRow label={t("summaryUsers")} value={String(config.users.length)} />
            </dl>

            <div className="mt-3 rounded-lg bg-[var(--surface-subtle)] p-3">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">{t("beforePublish")}</p>
              <ul className="mt-2 space-y-1.5">
                {checks.map((check) => (
                  <li key={check.label} className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full",
                        check.done ? "bg-[var(--status-working-fg)] text-white" : "border border-[var(--status-neutral-fg)] text-transparent",
                      )}
                    >
                      <Check className="size-2.5" aria-hidden />
                    </span>
                    {check.label}
                  </li>
                ))}
              </ul>
            </div>

            <Button
              variant="portal-secondary"
              className="mt-3 h-9 w-full cursor-pointer"
              disabled={!config.projectKey}
              render={<Link href={`/client-portal-v2/preview/${config.projectKey}`} />}
            >
              {t("previewAsClient")}
            </Button>
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-[var(--status-working-bg)] px-2.5 py-2 text-[11px] text-[var(--status-working-fg)]">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t("publishNote")}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

