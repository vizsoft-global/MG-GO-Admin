"use client";

import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  formatBatteryPct,
  formatDistanceMeters,
  formatSpeedMps,
} from "@/features/locations/location-status";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";

function pinVariant(status: "active" | "idle" | "alert") {
  if (status === "active") return "success" as const;
  if (status === "idle") return "warning" as const;
  return "danger" as const;
}

export function DriverLocationsLivePanel({
  intakeIdByProfileId,
}: {
  intakeIdByProfileId?: Map<string, string>;
}) {
  const t = useTranslations("pages.drivers");
  const tLoc = useTranslations("pages.locations");
  const { locations, isLoading } = useDriverLocationsRealtime();

  return (
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{t("liveLocationsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t("liveLocationsLoading")}</p>
        ) : locations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t("liveLocationsEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{tLoc("trackingStatusLabel")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{tLoc("zoneStatusLabel")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{tLoc("lastSeenLabel")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{tLoc("speedLabel")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{tLoc("distanceTodayLabel")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{tLoc("batteryLabel")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{tLoc("statusLabel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((loc) => (
                <TableRow key={loc.driverId} className="hover:bg-muted/40">
                  <TableCell>
                    {intakeIdByProfileId?.get(loc.driverId) ? (
                      <Link
                        href={`/drivers/${intakeIdByProfileId.get(loc.driverId)}?tab=location`}
                        className="font-medium text-primary hover:underline"
                      >
                        {loc.driverName}
                      </Link>
                    ) : (
                      <span className="font-medium">{loc.driverName}</span>
                    )}
                    <p className="text-xs text-muted-foreground">#{loc.driverCode}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {tLoc(`trackingStatus.${loc.trackingStatus}`)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {loc.zoneStatus ? tLoc(`zoneStatus.${loc.zoneStatus}`) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(loc.lastSeenAt).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="text-sm">{formatSpeedMps(loc.speedMps)}</TableCell>
                  <TableCell className="text-sm">
                    {formatDistanceMeters(loc.distanceTodayMeters)}
                  </TableCell>
                  <TableCell className="text-sm">{formatBatteryPct(loc.batteryPct)}</TableCell>
                  <TableCell>
                    <StatusPill variant={pinVariant(loc.pinStatus)} dot>
                      {tLoc(`pinStatus.${loc.pinStatus}`)}
                    </StatusPill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
