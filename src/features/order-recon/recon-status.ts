import type { OrderReconEmployee } from "./order-recon-views";

export function reconStatusVariant(
  status: OrderReconEmployee["status"] | "match" | "mismatch" | "app_only",
): "success" | "warning" | "danger" | "neutral" {
  if (status === "match") return "success";
  if (status === "unused" || status === "unresolved" || status === "app_only") return "warning";
  return "danger";
}
