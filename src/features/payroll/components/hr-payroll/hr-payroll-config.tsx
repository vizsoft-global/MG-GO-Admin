"use client";

import { useMemo, useState, type JSX } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { SearchSelect } from "@/components/ui/search-select";
import { HR_VEHICLES, type HrRateEvent, type HrRateLine, type HrVehicleType } from "@/features/payroll/hr-rate";

export type HrPayrollConfigLabels = {
  title: string;
  add: string;
  vehicle: string;
  project: string;
  zone: string;
  rate: string;
  save: string;
  invalid: string;
  empty: string;
  history: string;
  search: string;
  when: string;
  by: string;
  item: string;
  change: string;
  before: string;
  after: string;
  bike: string;
  car: string;
  rateAdded: string;
  rateChanged: string;
  rateRemoved: string;
  pickProject: string;
  pickZone: string;
  intro: string;
  lineCount: string;
  saveOne: string;
  saveMany: string;
  rateKwd: string;
  remove: string;
  chooseZone: string;
  none: string;
  current: string;
  historySub: string;
  searchPlaceholder: string;
  noRateStrong: string;
  noRateAdd: string;
  allRated: string;
};

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/#(\w+)#/g, (_, key: string) => String(values[key] ?? ""));
}

function blankLine(): HrRateLine {
  return { id: crypto.randomUUID(), vehicle: "Bike", project: "", zones: [], rate: 0 };
}

function fieldLabel(field: HrRateEvent["field"], labels: HrPayrollConfigLabels): string {
  switch (field) {
    case "Rate":
      return labels.rateChanged;
    case "Rate added":
      return labels.rateAdded;
    case "Rate removed":
      return labels.rateRemoved;
    default: {
      const unreachable: never = field;
      return unreachable;
    }
  }
}

function vehicleName(vehicle: HrVehicleType, labels: HrPayrollConfigLabels): string {
  switch (vehicle) {
    case "Bike":
      return labels.bike;
    case "Car":
      return labels.car;
    default: {
      const unreachable: never = vehicle;
      return unreachable;
    }
  }
}

export function HrPayrollConfig(props: {
  projects: readonly string[];
  zones: readonly string[];
  lines: readonly HrRateLine[];
  history: readonly HrRateEvent[];
  missing: readonly { label: string; count: number }[] | null;
  canManage: boolean;
  saving: boolean;
  labels: HrPayrollConfigLabels;
  onSave: (lines: readonly HrRateLine[]) => void;
}): JSX.Element {
  const { labels } = props;
  const [lines, setLines] = useState<HrRateLine[]>(() => (props.lines.length > 0 ? props.lines.map((line) => ({ ...line, zones: [...line.zones] })) : [blankLine()]));
  const [invalid, setInvalid] = useState(false);
  const [query, setQuery] = useState("");
  const projectItems = useMemo(
    () => props.projects.map((project) => ({ value: project, label: project, keywords: [project] })),
    [props.projects],
  );
  const history = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return props.history;
    return props.history.filter((event) =>
      `${event.item} ${event.field} ${event.by} ${event.from} ${event.to}`.toLowerCase().includes(needle),
    );
  }, [props.history, query]);

  function patch(id: string, next: Partial<HrRateLine>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...next } : line)));
  }

  function save() {
    const kept: HrRateLine[] = [];
    for (const line of lines) {
      const project = line.project.trim();
      const empty = project.length === 0 && line.zones.length === 0 && line.rate === 0;
      if (empty) continue;
      if (project.length === 0 || line.zones.length === 0 || !Number.isFinite(line.rate) || line.rate < 0) {
        setInvalid(true);
        return;
      }
      kept.push({ ...line, project, rate: line.rate });
    }
    setInvalid(false);
    props.onSave(kept);
  }

  function currentHint(line: HrRateLine): string {
    if (line.zones.length === 0) return labels.chooseZone;
    const detail = line.zones
      .map((zone) => {
        const saved = props.lines.find(
          (item) =>
            item.vehicle === line.vehicle &&
            item.project.trim() === line.project.trim() &&
            item.zones.some((value) => value.trim() === zone.trim()),
        );
        return `${zone}: ${saved ? saved.rate.toFixed(3) : labels.none}`;
      })
      .join(" · ");
    return fill(labels.current, { detail });
  }

  const missingCount = props.missing?.reduce((sum, item) => sum + item.count, 0) ?? 0;

  return (
    <div className="hrpay-config">
      <p className="hrpay-cfg-intro">{labels.intro}</p>
      <div className="hrpay-cfgform">
        <div className="hrpay-cfgform-bar">
          <span>{lines.length > 1 ? fill(labels.lineCount, { count: lines.length }) : ""}</span>
          <button type="button" className="hrpay-btn" disabled={!props.canManage} onClick={() => setLines((current) => [...current, blankLine()])}>
            <Plus size={14} fill="currentColor" stroke="currentColor" strokeWidth={2.25} aria-hidden />
            {labels.add}
          </button>
        </div>
        {lines.map((line, index) => (
          <div key={line.id} className="hrpay-cline" role="group" aria-label={`${labels.rate} ${index + 1}`}>
            <label>
              {labels.vehicle}
              <select
                className="hrpay-select"
                value={line.vehicle}
                disabled={!props.canManage}
                onChange={(event) => {
                  const vehicle = event.target.value;
                  if (vehicle === "Bike" || vehicle === "Car") patch(line.id, { vehicle });
                }}
              >
                {HR_VEHICLES.map((vehicle) => (
                  <option key={vehicle} value={vehicle}>
                    {vehicleName(vehicle, labels)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.project}
              <SearchSelect
                items={projectItems}
                value={line.project || null}
                onChange={(next) => patch(line.id, { project: next ?? "" })}
                placeholder={labels.pickProject}
                searchPlaceholder={labels.pickProject}
                emptyText={labels.pickProject}
                recentsKey="hr-rate-project"
                disabled={!props.canManage}
              />
            </label>
            <div className="hrpay-field">
              {labels.zone}
              <details className="hrpay-multi">
                <summary>{line.zones.length > 0 ? line.zones.join(", ") : labels.pickZone}</summary>
                <div>
                  {props.zones.map((zone) => (
                    <div key={zone} className="hrpay-multi-opt">
                      <input
                        type="checkbox"
                        checked={line.zones.includes(zone)}
                        disabled={!props.canManage}
                        onChange={() =>
                          patch(line.id, {
                            zones: line.zones.includes(zone)
                              ? line.zones.filter((value) => value !== zone)
                              : [...line.zones, zone],
                          })
                        }
                      />
                      <span>{zone}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <label>
              {labels.rateKwd}
              <input
                className="hrpay-search"
                type="number"
                min={0}
                step="0.001"
                placeholder="0.000"
                value={String(line.rate)}
                disabled={!props.canManage}
                onChange={(event) => patch(line.id, { rate: Number(event.target.value) })}
              />
              <span className="hrpay-cfg-hint">{currentHint(line)}</span>
            </label>
            {lines.length > 1 ? (
              <button
                type="button"
                className="hrpay-btn hrpay-cline-remove"
                disabled={!props.canManage}
                onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}
              >
                <Trash2 size={14} aria-hidden />
                {labels.remove}
              </button>
            ) : null}
          </div>
        ))}
        {invalid ? <p className="hrpay-cfg-warn">{labels.invalid}</p> : null}
        <div className="hrpay-cfg-actions">
          <button type="button" className="hrpay-btn hrpay-btn-primary" disabled={!props.canManage || props.saving} onClick={save}>
            {lines.length > 1 ? fill(labels.saveMany, { count: lines.length }) : labels.saveOne}
          </button>
        </div>
      </div>
      {props.missing === null ? null : missingCount > 0 ? (
        <div className="hrpay-cfg-warn" role="status">
          <strong>{fill(labels.noRateStrong, { count: missingCount })}</strong>{" "}
          {fill(labels.noRateAdd, {
            list: props.missing.map((item) => `${item.label} (${item.count})`).join(", "),
          })}
        </div>
      ) : (
        <div className="hrpay-cfg-ok" role="status">{labels.allRated}</div>
      )}
      <section className="hrpay-hist" aria-labelledby="hrpay-hist-h">
        <div>
          <h2 id="hrpay-hist-h">
            {labels.history} <span className="hrpay-chip">{props.history.length}</span>
          </h2>
          <p>{labels.historySub}</p>
        </div>
        <div className="hrpay-hist-card">
          <div className="hrpay-hist-tools">
            <label className="hrpay-hist-search">
              <Search size={14} aria-hidden />
              <input
                className="hrpay-search"
                value={query}
                aria-label={labels.search}
                placeholder={labels.searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="hrpay-scroll">
            <table className="hrpay-table">
              <thead>
                <tr>
                  <th>{labels.when}</th>
                  <th>{labels.by}</th>
                  <th>{labels.item}</th>
                  <th>{labels.change}</th>
                  <th>{labels.before}</th>
                  <th>{labels.after}</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{labels.empty}</td>
                  </tr>
                ) : (
                  history.map((event) => (
                    <tr key={event.id}>
                      <td>{event.at}</td>
                      <td>{event.by}</td>
                      <td>{event.item}</td>
                      <td>{fieldLabel(event.field, labels)}</td>
                      <td className="hrpay-old">{event.from}</td>
                      <td className="hrpay-new">{event.to}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
