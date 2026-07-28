import type { AlertCenterItem, DashboardSnapshot } from "./types";

export function buildOperationalAlerts(
  snapshot: Pick<DashboardSnapshot, "workforceQueue" | "deliveryMetrics" | "kpis">,
): AlertCenterItem[] {
  const live: AlertCenterItem[] = [];
  const now = new Date().toISOString();

  const silentCount = snapshot.workforceQueue.filter((r) => r.status === "silent").length;
  if (silentCount > 0) {
    live.push({
      id: "live-silent",
      severity: "warning",
      messageKey: "inactiveHours",
      detail: `${silentCount} drivers silent`,
      at: now,
      isLive: true,
    });
  }

  if (snapshot.deliveryMetrics.spikeDetected) {
    live.push({
      id: "live-spike",
      severity: "warning",
      messageKey: "deliveryAnomaly",
      detail: "Unusual delivery volume today",
      at: now,
      isLive: true,
    });
  }

  if (snapshot.kpis.verificationBacklog > 0) {
    live.push({
      id: "live-not-reported",
      severity: "info",
      messageKey: "verificationBacklog",
      detail: `${snapshot.kpis.verificationBacklog} verification backlog`,
      at: now,
      isLive: true,
    });
  }

  return live;
}
