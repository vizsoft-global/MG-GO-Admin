export function canResendEsign(status: string | null | undefined): boolean {
  return status === "declined";
}

export function esignResendHref(input: {
  requestId: string;
  driverId?: string | null;
  templateId?: string | null;
}): string {
  const params = new URLSearchParams({ resentFrom: input.requestId });
  if (input.driverId) params.set("driver", input.driverId);
  if (input.templateId) params.set("template", input.templateId);
  return `/employeedesk/esign/send?${params.toString()}`;
}
