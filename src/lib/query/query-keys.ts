/**
 * Central query key factories — keeps invalidation and prefetch stable across the app.
 * Example: queryClient.invalidateQueries({ queryKey: queryKeys.drivers.all() })
 */
export const queryKeys = {
  app: {
    buildId: () => ["app", "build-id"] as const,
  },
  drivers: {
    all: () => ["drivers"] as const,
    list: (filters: Record<string, unknown> = {}) => ["drivers", "list", filters] as const,
    detail: (id: string) => ["drivers", "detail", id] as const,
    devices: (driverId: string) => ["drivers", "devices", driverId] as const,
    multiDeviceRecent: (days: number) => ["drivers", "multi-device-recent", days] as const,
    assignRestaurant: (restaurantId: string) =>
      ["drivers", "assign", "restaurant", restaurantId] as const,
    assignZone: (zoneId: string) => ["drivers", "assign", "zone", zoneId] as const,
    assignPreview: (driverId: string) => ["drivers", "assign", "preview", driverId] as const,
    assignSearch: (query: string) => ["drivers", "assign", "search", query] as const,
    documents: (intakeId: string, profileId: string | null) =>
      ["drivers", "documents", intakeId, profileId] as const,
    loginVerifications: (
      driverId: string,
      startDate: string | null,
      endDate: string | null,
    ) =>
      ["drivers", "login-verifications", driverId, startDate, endDate] as const,
  },
  liveTracking: {
    all: () => ["live-tracking"] as const,
    history: (driverId: string, date: string) =>
      ["live-tracking", "history", driverId, date] as const,
    historyRange: (driverId: string, fromDate: string, toDate: string) =>
      ["live-tracking", "history", driverId, fromDate, toDate] as const,
    historyActiveDates: (driverId: string, yearMonth: string) =>
      ["live-tracking", "history-active-dates", driverId, yearMonth] as const,
    restaurantPins: (driverId: string) =>
      ["live-tracking", "restaurant-pins", driverId] as const,
  },
  partners: {
    all: () => ["partners"] as const,
    list: () => ["partners", "list"] as const,
    detail: (id: string) => ["partners", "detail", id] as const,
  },
  assets: {
    all: () => ["assets"] as const,
    list: () => ["assets", "list"] as const,
    detail: (id: string) => ["assets", "detail", id] as const,
    catalogForDriver: (intakeId: string | null) =>
      ["assets", "catalog-for-driver", intakeId ?? "new"] as const,
  },
  restaurants: {
    all: () => ["restaurants"] as const,
    list: () => ["restaurants", "list"] as const,
    detail: (id: string) => ["restaurants", "detail", id] as const,
    assignedDrivers: (id: string) => ["restaurants", "assigned-drivers", id] as const,
    deliveries: (id: string, filters: Record<string, unknown> = {}) =>
      ["restaurants", "deliveries", id, filters] as const,
    activity: (id: string) => ["restaurants", "activity", id] as const,
    partnerOptions: () => ["restaurants", "partner-options"] as const,
    zoneOptions: () => ["restaurants", "zone-options"] as const,
  },
  deliveries: {
    all: () => ["deliveries"] as const,
    list: (filters: Record<string, unknown> = {}) => ["deliveries", "list", filters] as const,
    kpis: () => ["deliveries", "kpis"] as const,
    filterOptions: () => ["deliveries", "filter-options"] as const,
    detail: (id: string) => ["deliveries", "detail", id] as const,
    live: (zoneId?: string) => ["deliveries", "live", zoneId ?? "all"] as const,
    deliveryGpsAudit: (deliveryId: string) =>
      ["deliveries", "gps-audit", deliveryId] as const,
    detailExtras: (deliveryId: string, proofKeys: string[]) =>
      ["deliveries", "detail-extras", deliveryId, ...proofKeys.sort()] as const,
    gpsAudit: (deliveryId: string) =>
      ["deliveries", "gps-audit", deliveryId] as const,
    deliveryLiveLocation: (deliveryId: string) =>
      ["deliveries", "live-location", deliveryId] as const,
    proofDisplay: (objectKey: string) => ["deliveries", "proof-display", objectKey] as const,
    ordersReport: (from: string, to: string) =>
      ["deliveries", "orders-report", from, to] as const,
  },
  verifications: {
    all: () => ["verifications"] as const,
    list: (filters: Record<string, unknown> = {}) =>
      ["verifications", "list", filters] as const,
    stats: (filters: Record<string, unknown> = {}) =>
      ["verifications", "stats", filters] as const,
    detail: (id: string) => ["verifications", "detail", id] as const,
    importBatches: () => ["verifications", "import-batches"] as const,
    export: () => ["verifications", "export"] as const,
    lookup: () => ["verifications", "lookup"] as const,
  },
  zones: {
    all: () => ["zones"] as const,
    list: () => ["zones", "list"] as const,
    detail: (id: string) => ["zones", "detail", id] as const,
    drivers: (zoneId: string) => ["zones", "drivers", zoneId] as const,
  },
  vehicles: {
    all: () => ["vehicles"] as const,
    list: (filters: Record<string, unknown> = {}) => ["vehicles", "list", filters] as const,
    detail: (id: string) => ["vehicles", "detail", id] as const,
  },
  requests: {
    all: () => ["requests"] as const,
    list: (filters: Record<string, unknown> = {}) => ["requests", "list", filters] as const,
    detail: (id: string) => ["requests", "detail", id] as const,
  },
  visits: {
    all: () => ["visits"] as const,
    list: (filters: Record<string, unknown> = {}) => ["visits", "list", filters] as const,
    detail: (id: string) => ["visits", "detail", id] as const,
    departments: () => ["visits", "departments"] as const,
    branches: () => ["visits", "branches"] as const,
    slots: () => ["visits", "slots"] as const,
    reception: (date: string) => ["visits", "reception", date] as const,
  },
  attendance: {
    all: () => ["attendance"] as const,
    list: (filters: Record<string, unknown> = {}) => ["attendance", "list", filters] as const,
    kpis: (date: string, filters: Record<string, unknown> = {}) =>
      ["attendance", "kpis", date, filters] as const,
    dailyList: (filters: Record<string, unknown> = {}) =>
      ["attendance", "daily", filters] as const,
    exceptions: (filters: Record<string, unknown> = {}) =>
      ["attendance", "exceptions", filters] as const,
    analytics: (from: string, to: string) =>
      ["attendance", "analytics", from, to] as const,
    thresholdSettings: () => ["attendance", "threshold-settings"] as const,
    driverDetail: (driverId: string, from: string, to: string) =>
      ["attendance", "driver", driverId, from, to] as const,
  },
  performance: {
    all: () => ["performance"] as const,
    list: (filters: Record<string, unknown> = {}) =>
      ["performance", "list", filters] as const,
    detail: (driverId: string, from: string, to: string) =>
      ["performance", "detail", driverId, from, to] as const,
    recentDeliveries: (limit: number) =>
      ["performance", "recent-deliveries", limit] as const,
    weights: () => ["performance", "weights"] as const,
  },
  driverShifts: {
    all: () => ["driver-shifts"] as const,
    list: (filters: Record<string, unknown> = {}) => ["driver-shifts", "list", filters] as const,
  },
  worktime: {
    all: () => ["worktime"] as const,
    list: (filters: Record<string, unknown> = {}) => ["worktime", "list", filters] as const,
  },
  admin: {
    roles: () => ["admin", "roles"] as const,
    pendingProfiles: () => ["admin", "profiles", "pending"] as const,
  },
  dpd: {
    all: () => ["dpd"] as const,
    restaurants: () => ["dpd", "restaurants"] as const,
    deliveryRules: () => ["dpd", "delivery-rules"] as const,
    incentiveRules: () => ["dpd", "incentive-rules"] as const,
    scopeOptions: () => ["dpd", "scope-options"] as const,
  },
  earnings: {
    all: () => ["earnings"] as const,
    daily: (startDate: string, endDate: string, driverId: string | null) =>
      ["earnings", "daily", startDate, endDate, driverId ?? "all"] as const,
    overview: (startDate: string, endDate: string, filters: Record<string, unknown> = {}) =>
      ["earnings", "overview", startDate, endDate, filters] as const,
    grouped: (
      startDate: string,
      endDate: string,
      groupBy: string,
      filters: Record<string, unknown> = {},
    ) => ["earnings", "grouped", startDate, endDate, groupBy, filters] as const,
  },
  payouts: {
    all: () => ["payouts"] as const,
    list: (startDate: string, endDate: string) => ["payouts", "list", startDate, endDate] as const,
    detail: (id: string) => ["payouts", "detail", id] as const,
  },
  dataCleanup: {
    all: () => ["data-cleanup"] as const,
    candidates: (
      tab: string,
      search: string,
      page: number,
      archivedOnly: boolean,
    ) => ["data-cleanup", "candidates", tab, search, page, archivedOnly] as const,
  },
  notifications: {
    all: () => ["notifications"] as const,
    dashboard: () => ["notifications", "dashboard"] as const,
    list: (filters: Record<string, unknown> = {}) =>
      ["notifications", "list", filters] as const,
    detail: (id: string) => ["notifications", "detail", id] as const,
    dispatchItems: (id: string) => ["notifications", "dispatch-items", id] as const,
    screenshotEvents: (id: string) => ["notifications", "screenshot-events", id] as const,
    templates: () => ["notifications", "templates"] as const,
    templateDetail: (id: string) => ["notifications", "templates", id] as const,
    automations: () => ["notifications", "automations"] as const,
    automationDetail: (id: string) => ["notifications", "automations", id] as const,
    analyticsDaily: (filters: Record<string, unknown> = {}) =>
      ["notifications", "analytics-daily", filters] as const,
    targetingOptions: () => ["notifications", "targeting-options"] as const,
    driverSearch: (query: string) => ["notifications", "driver-search", query] as const,
  },
  driverGroups: {
    all: () => ["driver-groups"] as const,
    list: () => ["driver-groups", "list"] as const,
    detail: (id: string) => ["driver-groups", "detail", id] as const,
    forDriver: (driverId: string) => ["driver-groups", "for-driver", driverId] as const,
    searchDrivers: (query: string) => ["driver-groups", "search-drivers", query] as const,
  },
  documentExpiry: {
    all: () => ["document-expiry"] as const,
    dashboard: () => ["document-expiry", "dashboard"] as const,
  },
  customFields: {
    all: () => ["custom-fields"] as const,
    list: (entityType: string, includeInactive = false) =>
      ["custom-fields", entityType, includeInactive] as const,
  },
  uiPreferences: {
    effective: (key: string) => ["ui-preferences", "effective", key] as const,
    roleDefault: (roleId: string, key: string) =>
      ["ui-preferences", "role", roleId, key] as const,
  },
} as const;
