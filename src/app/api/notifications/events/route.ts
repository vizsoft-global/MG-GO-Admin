import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    campaign_id?: string;
    dispatch_item_id?: string;
    event_type?: string;
    event_at?: string;
    meta?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.campaign_id || !body.dispatch_item_id || !body.event_type) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // RPC added in migration 20260626920000; cast until types catch up
  const { error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>;
    }
  ).rpc("record_notification_client_event", {
      p_campaign_id: body.campaign_id,
      p_dispatch_item_id: body.dispatch_item_id,
      p_event_type: body.event_type,
      p_event_at: body.event_at ?? new Date().toISOString(),
      p_metadata: body.meta ?? {},
    },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
