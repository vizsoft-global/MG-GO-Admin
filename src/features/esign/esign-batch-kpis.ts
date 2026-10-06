export type EsignBatchKpis = {
  batchesSent: number;
  waitingSignatures: number;
  fullySigned: number;
  declined: number;
};

export function parseEsignBatchKpis(payload: Record<string, unknown> | null): EsignBatchKpis | null {
  if (!payload || payload.ok === false) return null;
  return {
    batchesSent: Number(payload.batches_sent ?? 0),
    waitingSignatures: Number(payload.waiting_signatures ?? 0),
    fullySigned: Number(payload.fully_signed ?? 0),
    declined: Number(payload.declined ?? 0),
  };
}
