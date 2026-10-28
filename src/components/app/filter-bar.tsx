"use client";

import type { ReactNode } from "react";
import { Briefcase, CalendarRange, Car, MapPinned, UserRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";

export type FilterChoice = { value: string; label: string };

const KEYS = ["project", "from", "to", "zone", "vehicle"] as const;

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Briefcase;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-[var(--text-secondary)]">
      <span className="inline-flex items-center gap-1">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      {children}
    </label>
  );
}

const control =
  "h-9 w-full rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-sm text-[var(--text-primary)]";

export function FilterBar({
  projects,
  zones,
  vehicles,
  labels,
  comingSoonLabel = "Coming soon",
  clearLabel = "Clear filters",
}: {
  projects: readonly FilterChoice[];
  zones: readonly FilterChoice[];
  vehicles: readonly FilterChoice[];
  labels: { project: string; date: string; zone: string; supervisor: string; vehicle: string; from: string; to: string };
  comingSoonLabel?: string;
  clearLabel?: string;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const setKey = (key: (typeof KEYS)[number], value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const clear = () => {
    const next = new URLSearchParams(params.toString());
    for (const key of KEYS) next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex flex-wrap items-end gap-[var(--gap-section)]">
      <Field icon={Briefcase} label={labels.project}>
        <select className={control} value={params.get("project") ?? ""} onChange={(event) => setKey("project", event.target.value)}>
          <option value="">{labels.project}</option>
          {projects.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </Field>
      <Field icon={CalendarRange} label={labels.date}>
        <span className="flex gap-[var(--gap-tight)]">
          <input className={control} type="date" aria-label={labels.from} value={params.get("from") ?? ""} onChange={(event) => setKey("from", event.target.value)} />
          <input className={control} type="date" aria-label={labels.to} value={params.get("to") ?? ""} onChange={(event) => setKey("to", event.target.value)} />
        </span>
      </Field>
      <Field icon={MapPinned} label={labels.zone}>
        <select className={control} value={params.get("zone") ?? ""} onChange={(event) => setKey("zone", event.target.value)}>
          <option value="">{labels.zone}</option>
          {zones.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </Field>
      <Field icon={UserRound} label={labels.supervisor}>
        <span className="flex items-center gap-2">
          <select className={control} disabled value="" aria-disabled>
            <option value="">{labels.supervisor}</option>
          </select>
          <span className="shrink-0 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
            {comingSoonLabel}
          </span>
        </span>
      </Field>
      <Field icon={Car} label={labels.vehicle}>
        <select className={control} value={params.get("vehicle") ?? ""} onChange={(event) => setKey("vehicle", event.target.value)}>
          <option value="">{labels.vehicle}</option>
          {vehicles.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </Field>
      <button type="button" className="h-9 rounded-[var(--radius-control)] border border-[var(--border-default)] px-3 text-sm text-[var(--text-primary)]" onClick={clear}>
        {clearLabel}
      </button>
    </div>
  );
}
