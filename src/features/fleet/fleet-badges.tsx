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

type VehicleStatus = "active" | "suspended" | "maintenance";

function vehicleStatusLabel(
  status: VehicleStatus,
  t: ReturnType<typeof useTranslations<"pages.vehicles">>,
): string {
  switch (status) {
    case "active":
      return t("statusActive");
    case "suspended":
      return t("statusSuspended");
    case "maintenance":
      return t("statusMaintenance");
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

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
        "inline-flex h-5 max-w-full items-center gap-1 rounded-md border px-1.5 text-xs font-semibold leading-none",
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
        "inline-flex max-w-full items-center rounded-[12px] px-[9px] py-[3px] text-xs font-medium leading-none",
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

export function CarTypeBadge({ value }: { value: VehicleCarType | null | undefined }) {
  const t = useTranslations("pages.vehicles");
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-[4px] px-[9px] py-[3px] text-xs font-medium leading-none text-white",
        CAR_TYPE_CLASS[value],
      )}
    >
      <span className="truncate">{t(`carType.${value}`)}</span>
    </span>
  );
}

export function VehicleStatusBadge({
  status,
}: {
  status: VehicleStatus;
}) {
  const t = useTranslations("pages.vehicles");
  const label = vehicleStatusLabel(status, t);
  if (status === "maintenance") {
    return (
      <Pill icon={Wrench} className="border-warning/50 bg-warning-bg text-warning">
        {label}
      </Pill>
    );
  }
  if (status === "suspended") {
    return <Pill className="border-destructive/30 bg-destructive/10 text-destructive">{label}</Pill>;
  }
  return <Pill className="border-success/30 bg-success-bg text-success">{label}</Pill>;
}

const CONDITION_CLASS: Record<VehicleCondition, string> = {
  running: "border-success/30 bg-success-bg text-success",
  inventory_assembled: "border-border bg-muted/40 text-muted-foreground",
  sold: "border-border bg-muted/40 text-muted-foreground",
  deadstock: "border-border bg-muted/40 text-muted-foreground",
  stolen: "border-destructive/30 bg-destructive/10 text-destructive",
  repair_required: "border-warning/40 bg-warning-bg text-warning",
  standby: "border-border bg-muted/40 text-muted-foreground",
  police_custody: "border-destructive/30 bg-destructive/10 text-destructive",
  accident: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function ConditionBadge({ value }: { value: VehicleCondition | null | undefined }) {
  const t = useTranslations("pages.vehicles");
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Pill className={CONDITION_CLASS[value]}>{t(`condition.${value}`)}</Pill>;
}

export function KindBadge({ value }: { value: string | null | undefined }) {
  const t = useTranslations("pages.vehicles");
  const isCar = value === "car";
  return (
    <SoftPill
      className={
        isCar ? "bg-fleet-kind-car text-fleet-kind-car-fg" : "bg-fleet-kind-bike text-fleet-kind-bike-fg"
      }
    >
      {isCar ? t("kindCar") : t("kindBike")}
    </SoftPill>
  );
}

export function FuelTypeBadge({ value }: { value: VehicleFuelType | null | undefined }) {
  const t = useTranslations("pages.vehicles");
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
      {t(`fuelType.${value}`)}
    </Pill>
  );
}

export function FuelCompanyBadge({ value }: { value: VehicleFuelCompany | null | undefined }) {
  const t = useTranslations("pages.vehicles");
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Pill className="border-border bg-muted/30 font-mono text-muted-foreground uppercase">
      {t(`fuelCompany.${value}`)}
    </Pill>
  );
}

export function ProjectBadge({ value }: { value: DriverProjectKey | null | undefined }) {
  const t = useTranslations("pages.vehicles");
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <SoftPill className="bg-fleet-purple text-fleet-purple-fg">
      {value === "keeta"
        ? t("projectKeeta")
        : value === "americana"
          ? t("projectAmericana")
          : t("projectFiveGuys")}
    </SoftPill>
  );
}

export function ReplacementBadge({ active }: { active: boolean }) {
  const t = useTranslations("pages.vehicles");
  if (!active) return <span className="text-muted-foreground">—</span>;
  return <SoftPill className="bg-fleet-purple text-fleet-purple-fg">{t("replacementBanner")}</SoftPill>;
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
