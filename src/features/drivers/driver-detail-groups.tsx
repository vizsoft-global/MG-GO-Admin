"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useDriverGroupsForDriver } from "@/features/driver-groups/use-driver-groups";

export function DriverDetailGroups({ driverId }: { driverId: string | null }) {
  const t = useTranslations("pages.driverGroups");
  const { data: groups = [] } = useDriverGroupsForDriver(driverId);

  if (!driverId || groups.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{t("title")}:</span>
      {groups.map((group) => (
        <Link
          key={group.id}
          href={`/drivers/groups/${group.id}`}
          className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary hover:underline"
        >
          {group.name}
        </Link>
      ))}
    </div>
  );
}
