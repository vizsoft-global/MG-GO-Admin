"use client";

import type { LucideIcon } from "lucide-react";
import { Car, Fuel, Repeat2, Wrench } from "lucide-react";
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

const CAR_TYPE_CLASS: Record<VehicleCarType, string> = {
  company: "border-primary/20 bg-primary/10 text-primary",
  rent: "border-warning/40 bg-warning-bg text-warning",
  maintenance: "border-border bg-muted text-foreground",
};

export function CarTypeBadge({ value }: { value: VehicleCarType | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const label =
    value === "company" ? "Company Car" : value === "rent" ? "Rent Car" : "Maintenance Car";
  return <Pill icon={Car} className={CAR_TYPE_CLASS[value]}>{label}</Pill>;
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
  const kind = value === "car" ? "Car" : "Bike";
  return <Pill className="border-border bg-muted/30 text-muted-foreground">{kind}</Pill>;
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
    <Pill className="border-border bg-muted/30 text-muted-foreground font-mono uppercase">
      {value}
    </Pill>
  );
}

export function ProjectBadge({ value }: { value: DriverProjectKey | null | undefined }) {
  const t = useTranslations("pages.vehicles");
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Pill className="border-primary/20 bg-primary/10 text-primary">
      {value === "keeta" ? t("projectKeeta") : t("projectAmericana")}
    </Pill>
  );
}

export function ReplacementBadge({ active }: { active: boolean }) {
  if (!active) return <span className="text-muted-foreground">—</span>;
  return (
    <Pill icon={Repeat2} className="border-warning/50 bg-warning-bg text-warning">
      Replacement
    </Pill>
  );
}
