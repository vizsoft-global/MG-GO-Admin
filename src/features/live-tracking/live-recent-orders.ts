function shortId(uuid: string): string {
  return uuid.slice(0, 8).toUpperCase();
}

export function liveOrderDisplayId(row: {
  external_order_id?: string | null;
  id: string;
}): string {
  const external = row.external_order_id?.trim();
  return external || shortId(row.id);
}

export function liveOrderTimestamp(row: {
  delivered_at?: string | null;
  created_at?: string | null;
}): string | null {
  return row.delivered_at ?? row.created_at ?? null;
}
