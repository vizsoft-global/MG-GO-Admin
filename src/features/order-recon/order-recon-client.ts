import type { ComparisonSnapshot } from "./order-comparison-model";
import type { ReconPreview } from "./order-recon-actions";
import { reconCommitPayload } from "./order-recon-resolve";
import type { OrderReconRun } from "./order-recon-types";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: "request_failed" };
  }
}

async function postJson(
  url: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await readJson(res);
    if (typeof parsed.error === "string" && parsed.error) return parsed;
    if (!res.ok) return { error: "request_failed" };
    return parsed;
  } catch {
    return { error: "request_failed" };
  }
}

export async function fetchOrderReconPreview(
  file: File,
): Promise<{ preview: ReconPreview } | { error: string }> {
  try {
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/order-recon/preview", {
      method: "POST",
      credentials: "same-origin",
      body: fd,
    });
    const parsed = await readJson(res);
    if (typeof parsed.error === "string" && parsed.error) {
      return { error: parsed.error };
    }
    if (!res.ok || !parsed.preview) return { error: "preview_failed" };
    return { preview: parsed.preview as ReconPreview };
  } catch {
    return { error: "request_failed" };
  }
}

export async function fetchOrderReconCommit(
  preview: ReconPreview,
): Promise<{ run: OrderReconRun } | { error: string }> {
  const parsed = await postJson("/api/order-recon/commit", reconCommitPayload(preview));
  if (typeof parsed.error === "string" && parsed.error) {
    return { error: parsed.error };
  }
  if (!parsed.run) return { error: "save_failed" };
  return { run: parsed.run as OrderReconRun };
}

export async function fetchOrderReconUndo(): Promise<{ error?: string }> {
  const parsed = await postJson("/api/order-recon/undo");
  return typeof parsed.error === "string" ? { error: parsed.error } : {};
}

export async function fetchOrderReconRedo(): Promise<{ error?: string }> {
  const parsed = await postJson("/api/order-recon/redo");
  return typeof parsed.error === "string" ? { error: parsed.error } : {};
}

export async function fetchOrderComparison(input: {
  from: string;
  to: string;
}): Promise<{ snapshot: ComparisonSnapshot } | { error: string }> {
  const parsed = await postJson("/api/order-recon/comparison", input);
  if (typeof parsed.error === "string" && parsed.error) {
    return { error: parsed.error };
  }
  if (!parsed.snapshot) return { error: "compare_failed" };
  return { snapshot: parsed.snapshot as ComparisonSnapshot };
}
