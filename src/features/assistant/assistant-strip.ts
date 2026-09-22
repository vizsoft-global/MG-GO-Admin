const FORBIDDEN_KEY_RE =
  /(passcode|civil_id|payload|attachment|storage_key|object_key|signed_url|latitude|longitude|^lat$|^lng$|gps_|chassis|chip_no|target_spec|exclusion_spec|custom_fields|documents|avatar_object|access_kind|staff_access|matrix)/i;

export const FORBIDDEN_STRIP_KEYS = [
  "app_passcode",
  "civil_id",
  "payload",
  "attachments",
  "attachment_keys",
  "storage_key",
  "signed_url",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "gps_accuracy_meters",
  "gps_is_mocked",
  "gps_zone_status",
  "chassis_no",
  "chip_no",
  "target_spec",
  "exclusion_spec",
  "custom_fields",
  "documents",
  "avatar_object_key",
  "body",
] as const;

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_RE.test(key);
}

export function pickAllowlisted<T extends Record<string, unknown>>(
  row: T | null | undefined,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in row && !isForbiddenKey(key)) out[key] = row[key];
  }
  return out;
}

export function assertNoForbiddenKeys(payload: unknown, path = "root"): void {
  if (!payload || typeof payload !== "object") return;
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (isForbiddenKey(key)) throw new Error(`forbidden_key:${key}`);
    if (value && typeof value === "object") assertNoForbiddenKeys(value, `${path}.${key}`);
  }
}

export function stripDriverIdentity(
  row: Record<string, unknown>,
  opts: { showContact: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id ?? row.driver_id ?? null,
    name: row.full_name ?? row.driver_name ?? row.name ?? null,
    driver_code: row.driver_code ?? null,
    employee_id: row.employee_id ?? null,
    status: row.account_status ?? row.status ?? row.driver_status ?? null,
    zone: row.zone_label ?? row.zone_name ?? row.zone ?? null,
    zone_id: row.zone_id ?? null,
    partner: row.partner_name ?? row.partner ?? null,
    project_key: row.project_key ?? null,
    vehicle: row.vehicle_label ?? null,
    vehicle_id: row.vehicle_id ?? null,
    is_blocked: row.is_blocked ?? null,
    rider_category: row.rider_category ?? null,
  };
  if (opts.showContact) {
    const phone = row.phone ?? row.driver_phone;
    if (phone && phone !== "—") out.phone = phone;
    if (row.email) out.email = row.email;
  }
  return out;
}

export function stripAttendanceDay(row: Record<string, unknown>): Record<string, unknown> {
  return {
    driver_id: row.driver_id,
    log_date: row.log_date,
    driver_code: row.driver_code,
    driver_name: row.driver_name,
    zone_name: row.zone_name,
    attendance_status: row.attendance_status,
    live_status: row.live_status,
    check_in_at: row.check_in_at,
    check_out_at: row.check_out_at,
    check_out_reason: row.check_out_reason,
    online_seconds: row.online_seconds,
    duty_seconds: row.duty_seconds,
    minutes_late: row.minutes_late,
    minutes_early_out: row.minutes_early_out,
    compliance_score: row.compliance_score,
    is_on_duty: row.is_on_duty,
  };
}

export function stripPerformanceRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    driver_id: row.driver_id,
    driver_code: row.driver_code,
    employee_id: row.employee_id,
    driver_name: row.driver_name,
    zone_name: row.zone_name,
    partner_name: row.partner_name,
    restaurant_name: row.restaurant_name,
    worked_days: row.worked_days,
    leave_days: row.leave_days,
    absent_days: row.absent_days,
    actual_deliveries: row.actual_deliveries,
    target_deliveries: row.target_deliveries,
    delivery_efficiency: row.delivery_efficiency,
    utilization: row.utilization,
    compliance_score: row.compliance_score,
    overall_score: row.overall_score,
    band: row.band ?? null,
    is_on_duty: row.is_on_duty,
  };
}

export function stripRequestRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    request_code: row.request_code,
    request_type: row.request_type,
    status: row.status,
    current_step_label: row.current_step_label,
    driver_code: row.driver_code,
    driver_name: row.driver_name,
    driver_id: row.driver_id,
    driver_zone: row.driver_zone,
    amount_kwd: row.amount_kwd,
    created_at: row.created_at,
    severity: row.severity,
  };
}

export function stripDeliveryHead(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    short_id: row.short_id ?? null,
    status: row.status,
    external_order_id: row.external_order_id ?? null,
    created_at: row.created_at ?? null,
    delivered_at: row.delivered_at ?? null,
    partner_name: row.partner_name ?? null,
    driver_id: row.driver_id ?? null,
  };
}

export function stripVehicleRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    bike_id: row.bike_id,
    reg_number: row.reg_number,
    status: row.status,
    vehicle_type_key: row.vehicle_type_key,
    condition: row.condition,
    car_type: row.car_type,
    type_of_use: row.type_of_use,
    make: row.make ?? null,
    model: row.model ?? null,
    location_text: row.location_text ?? null,
    assigned_driver_id: row.assigned_driver_id ?? null,
    assigned_driver_name: row.assigned_driver_name ?? null,
    assigned_driver_code: row.assigned_driver_code ?? null,
  };
}

export function stripNotificationRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    category: row.category,
    sent_at: row.sent_at,
    recipient_count: row.recipient_count,
    delivered_count: row.delivered_count,
    failed_count: row.failed_count,
    created_at: row.created_at,
  };
}

export function stripActivityEvent(row: Record<string, unknown>): Record<string, unknown> {
  return {
    at: row.occurredAt ?? row.at ?? null,
    type: row.operationKey ?? row.kind ?? row.type ?? null,
    category: row.category ?? null,
    success: row.success ?? null,
    error_code: row.errorCode ?? row.error_code ?? null,
  };
}

export function sectionDenied(page: string): { error: "not_authorized"; page: string } {
  return { error: "not_authorized", page };
}

export function sectionUnavailable(reason: string): { error: "unavailable"; reason: string } {
  return { error: "unavailable", reason };
}
