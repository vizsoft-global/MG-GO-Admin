"use client";

import type { LucideIcon } from "lucide-react";
import { Fuel, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type {
  DriverProjectKey,
  VehicleCarType,
  VehicleCondition,
  VehicleFuelCompany,
  VehicleFuelType,
} from "./fleet-labels";

function Pill({
  icon: Icon,
  className,
  children,
}: {
  icon?: LucideIcon;
  className?: string;
  children: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold leading-none",
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function SoftPill({ className, children }: { className?: string; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-[12px] px-[9px] py-[3px] text-[11px] font-medium leading-none",
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

const CAR_TYPE_CLASS: Record<VehicleCarType, string> = {
  company: "bg-fleet-car-company",
  rent: "bg-fleet-car-rent",
  maintenance: "bg-fleet-car-maintenance",
};

const CAR_TYPE_LABEL: Record<VehicleCarType, string> = {
  company: "Company Car",
  rent: "Rent Car",
  maintenance: "Maintenance Car",
};

export function CarTypeBadge({ value }: { value: VehicleCarType | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-[4px] px-[9px] py-[3px] text-[11px] font-medium leading-none text-white",
        CAR_TYPE_CLASS[value],
      )}
    >
      <span className="truncate">{CAR_TYPE_LABEL[value]}</span>
    </span>
  );
}

export function VehicleStatusBadge({
  status,
}: {
  status: "active" | "suspended" | "maintenance";
}) {
  if (status === "maintenance") {
    return (
      <Pill icon={Wrench} className="border-warning/50 bg-warning-bg text-warning">
        Under Repair
      </Pill>
    );
  }
  if (status === "suspended") {
    return <Pill className="border-destructive/30 bg-destructive/10 text-destructive">Suspended</Pill>;
  }
  return <Pill className="border-success/30 bg-success-bg text-success">Active</Pill>;
}

const CONDITION_CLASS: Record<VehicleCondition, string> = {
  running: "border-success/30 bg-success-bg text-success",
  repair_required: "border-warning/40 bg-warning-bg text-warning",
  accident: "border-destructive/30 bg-destructive/10 text-destructive",
  standby: "border-border bg-muted/40 text-muted-foreground",
};

const CONDITION_LABEL: Record<VehicleCondition, string> = {
  running: "Running",
  repair_required: "Repair Required",
  accident: "Accident",
  standby: "Standby",
};

export function ConditionBadge({ value }: { value: VehicleCondition | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Pill className={CONDITION_CLASS[value]}>{CONDITION_LABEL[value]}</Pill>;
}

export function KindBadge({ value }: { value: string | null | undefined }) {
  const isCar = value === "car";
  return (
    <SoftPill
      className={
        isCar ? "bg-fleet-kind-car text-fleet-kind-car-fg" : "bg-fleet-kind-bike text-fleet-kind-bike-fg"
      }
    >
      {isCar ? "Car" : "Bike"}
    </SoftPill>
  );
}

export function FuelTypeBadge({ value }: { value: VehicleFuelType | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Pill
      icon={Fuel}
      className={
        value === "card"
          ? "border-border bg-muted text-foreground"
          : "border-primary/20 bg-primary/10 text-primary"
      }
    >
      {value === "card" ? "Fuel card" : "Chip"}
    </Pill>
  );
}

export function FuelCompanyBadge({ value }: { value: VehicleFuelCompany | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Pill className="border-border bg-muted/30 font-mono text-muted-foreground uppercase">
      {value}
    </Pill>
  );
}

export function ProjectBadge({ value }: { value: DriverProjectKey | null | undefined }) {
  const t = useTranslations("pages.vehicles");
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <SoftPill className="bg-fleet-purple text-fleet-purple-fg">
      {value === "keeta" ? t("projectKeeta") : t("projectAmericana")}
    </SoftPill>
  );
}

export function ReplacementBadge({ active }: { active: boolean }) {
  if (!active) return <span className="text-muted-foreground">—</span>;
  return <SoftPill className="bg-fleet-purple text-fleet-purple-fg">Replacement</SoftPill>;
}

export function DepartmentBadge({ value }: { value: string | null | undefined }) {
  const t = useTranslations("pages.fleetFuelQueue");
  if (!value) return <span className="text-muted-foreground">—</span>;
  const label =
    value === "Fleet" ? t("deptFleet") : value === "Accounts" ? t("deptAccounts") : value;
  return <SoftPill className="bg-fleet-blue text-fleet-blue-fg">{label}</SoftPill>;
}

export function HadBeforeBadge({ value }: { value: boolean | null | undefined }) {
  const t = useTranslations("pages.fleetFuelQueue");
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <SoftPill
      className={
        value ? "bg-fleet-amber text-fleet-amber-fg" : "bg-fleet-gray text-fleet-gray-fg"
      }
    >
      {value ? t("hadYes") : t("hadNo")}
    </SoftPill>
  );
}
