export type DispatchCounts = {
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Create-flow used to toast.success even when FCM sent 0 / failed 1,
 * so a completed request looked like a successful push.
 */
export function dispatchToastKind(
  result: DispatchCounts,
): "error" | "warning" | "success" {
  if (result.failed > 0) return "error";
  if (result.skipped > 0 && result.sent === 0) return "warning";
  return "success";
}

export function dispatchToastCopy(result: DispatchCounts): {
  kind: "error" | "warning" | "success";
  key: "sentPartial" | "sentInAppOnly" | "sentSuccess";
} {
  const kind = dispatchToastKind(result);
  if (kind === "error") return { kind, key: "sentPartial" };
  if (kind === "warning") return { kind, key: "sentInAppOnly" };
  return { kind, key: "sentSuccess" };
}

