"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fetchRosterAlerts } from "./roster-actions";
import { rosterError } from "./roster-result";

export function RosterAlertsShell() {
  const t = useTranslations("pages.roster");
  const query = useQuery({
    queryKey: ["roster", "alerts"],
    queryFn: () => fetchRosterAlerts(),
    staleTime: 60_000,
  });
  const data = query.data;
  const rows = data && "rows" in data ? data.rows : [];
  const failure = rosterError(data);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h1 className="type-h1">{t("alerts")}</h1>
        <Button variant="outline" className="h-9" nativeButton={false} render={<Link href="/operations/roster" />}>
          {t("schedule")}
        </Button>
      </div>
      {failure ? <p className="text-xs text-destructive">{t(`errors.${failure}`)}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-2 text-start font-semibold">{t("status")}</th>
              <th className="px-2 py-2 text-start font-semibold">{t("rider")}</th>
              <th className="px-2 py-2 text-start font-semibold">{t("zone")}</th>
              <th className="px-2 py-2 text-start font-semibold">{t("restaurant")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-muted-foreground" colSpan={4}>
                  {t("noRows")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2 py-1">{t(`statuses.${row.kind}`)}</td>
                  <td className="px-2 py-1">{row.driverId}</td>
                  <td className="px-2 py-1">{row.zoneId ?? "—"}</td>
                  <td className="px-2 py-1">{row.deliveryId ?? row.restaurantId ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
