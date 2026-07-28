import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { createClient } from "@/lib/supabase/server";

type NotificationsRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  if (request.method === "GET") {
    const limit = Number(searchParams.get("limit") ?? "50");
    const before = searchParams.get("before");
    const unreadOnly = searchParams.get("unread_only") === "1";

    const { data, error } = await (supabase as unknown as NotificationsRpc).rpc(
      "driver_list_notifications",
      {
        p_limit: Number.isFinite(limit) ? limit : 50,
        p_before: before ?? null,
        p_unread_only: unreadOnly,
      },
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(data ?? { items: [], unread_count: 0 });
  }

  // POST → mark read
  let body: { dispatch_item_ids?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { data, error } = await (supabase as unknown as NotificationsRpc).rpc(
    "driver_mark_notifications_read",
    {
      p_dispatch_item_ids: body.dispatch_item_ids ?? null,
    },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ updated: data ?? 0 });
}

export const GET = withCors(handler);
export const POST = withCors(handler);
export const OPTIONS = withCors(handler);
