export type DeliveryDecisionStatus = "verified" | "rejected";

export type DeliveryDecisionNotice = {
  title: string;
  body: string;
  deepLink: string;
  category: "operations";
  priority: "normal";
  actionParams: Record<string, unknown>;
};

function orderLabel(orderId: string | null | undefined, deliveryId: string): string {
  const trimmed = orderId?.trim() ?? "";
  if (trimmed !== "") return trimmed;
  return deliveryId.slice(0, 8).toUpperCase();
}

export function deliveryDecisionNotice(input: {
  status: DeliveryDecisionStatus;
  deliveryId: string;
  orderId?: string | null;
  reason?: string | null;
}): DeliveryDecisionNotice {
  const label = orderLabel(input.orderId, input.deliveryId);
  const actionParams: Record<string, unknown> = {
    record_type: "delivery",
    record_id: input.deliveryId,
    screen: "deliveries",
    route: "/deliveries",
  };
  switch (input.status) {
    case "verified":
      return {
        title: `Delivery verified — ${label}`,
        body: `Order ${label} has been verified.`,
        deepLink: "musallam:///deliveries",
        category: "operations",
        priority: "normal",
        actionParams,
      };
    case "rejected": {
      const reason = input.reason?.trim() ?? "";
      return {
        title: `Delivery rejected — ${label}`,
        body: reason !== "" ? reason : `Order ${label} was rejected.`,
        deepLink: "musallam:///deliveries",
        category: "operations",
        priority: "normal",
        actionParams,
      };
    }
    default: {
      const unreachable: never = input.status;
      return unreachable;
    }
  }
}
