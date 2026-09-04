import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FLUSH_GRACE_MS = 5 * 60 * 1000;

type LookupResult = {
  ok: boolean;
  user_id?: string;
  driver_code?: string;
  error?: string;
  reason?: string;
};

type DeviceMeta = {
  model?: string | null;
  manufacturer?: string | null;
  os_version?: string | null;
  android_sdk_int?: number | null;
  app_version_name?: string | null;
  app_version_code?: number | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseDeviceMeta(raw: unknown): DeviceMeta {
  if (!raw || typeof raw !== "object") return {};
  const meta = raw as Record<string, unknown>;
  const sdk = meta.android_sdk_int;
  const versionCode = meta.app_version_code;
  return {
    model: typeof meta.model === "string" ? meta.model : null,
    manufacturer: typeof meta.manufacturer === "string"
      ? meta.manufacturer
      : null,
    os_version: typeof meta.os_version === "string" ? meta.os_version : null,
    android_sdk_int: typeof sdk === "number"
      ? sdk
      : typeof sdk === "string" && sdk.trim() !== ""
      ? Number.parseInt(sdk, 10)
      : null,
    app_version_name: typeof meta.app_version_name === "string"
      ? meta.app_version_name
      : null,
    app_version_code: typeof versionCode === "number"
      ? versionCode
      : typeof versionCode === "string" && versionCode.trim() !== ""
      ? Number.parseInt(versionCode, 10)
      : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return json({ error: "server_misconfigured" }, 500);
  }

  let loginId: string;
  let passcode: string;
  let deviceId: string;
  let forceOverride = false;
  let deviceMeta: DeviceMeta = {};
  try {
    const body = await req.json();
    loginId = String(
      body?.employee_id ?? body?.driver_code ?? "",
    ).trim();
    passcode = String(body?.passcode ?? "").trim();
    deviceId = String(body?.device_id ?? "").trim();
    forceOverride = body?.force_override === true;
    deviceMeta = parseDeviceMeta(body?.device_meta);
  } catch {
    return json({ error: "invalid_credentials" }, 401);
  }

  if (!loginId || !passcode) {
    return json({ error: "invalid_credentials" }, 401);
  }

  if (!deviceId) {
    return json({ error: "device_id_required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Force-update gate. Checked before credentials so a blocked build learns it is
  // blocked without a passcode being validated for it, and no session is minted.
  // A build that does not report its versionCode is old enough to predate the
  // gate entirely and is treated as below any minimum.
  const { data: gateRow, error: gateError } = await admin
    .from("app_settings")
    .select(
      "driver_app_force_update, driver_app_min_version_code, driver_app_min_version_name, driver_app_update_message",
    )
    .eq("id", 1)
    .maybeSingle();

  if (gateError) {
    console.error("force-update gate read error", gateError.message);
  } else if (
    gateRow?.driver_app_force_update === true &&
    typeof gateRow.driver_app_min_version_code === "number"
  ) {
    const minCode = gateRow.driver_app_min_version_code as number;
    const reported = deviceMeta.app_version_code;
    const belowMinimum =
      reported == null || !Number.isFinite(reported) || reported < minCode;
    if (belowMinimum) {
      return json(
        {
          error: "update_required",
          min_version_code: minCode,
          min_version_name: gateRow.driver_app_min_version_name ?? null,
          message: gateRow.driver_app_update_message ?? null,
        },
        426,
      );
    }
  }

  const { data: lookupRaw, error: lookupError } = await admin.rpc(
    "driver_app_lookup_by_passcode",
    { p_driver_code: loginId, p_passcode: passcode },
  );

  if (lookupError) {
    console.error("lookup rpc error", lookupError.message);
    return json({ error: "invalid_credentials" }, 401);
  }

  const lookup = lookupRaw as LookupResult;
  if (!lookup?.ok || !lookup.user_id) {
    if (lookup?.error === "driver_blocked") {
      return json(
        {
          error: "driver_blocked",
          reason:
            typeof (lookup as { reason?: unknown }).reason === "string"
              ? (lookup as { reason?: string }).reason
              : null,
        },
        403,
      );
    }
    const err =
      lookup?.error === "driver_not_active"
        ? "driver_not_active"
        : lookup?.error === "driver_suspended"
        ? "driver_suspended"
        : lookup?.error === "driver_archived"
        ? "driver_archived"
        : "invalid_credentials";
    return json({ error: err }, 401);
  }

  const userId = lookup.user_id;
  const nowIso = new Date().toISOString();
  const flushDeadlineIso = new Date(Date.now() + FLUSH_GRACE_MS).toISOString();

  const { data: driverRow, error: driverError } = await admin
    .from("drivers")
    .select("active_device_id, active_device_session_id")
    .eq("id", userId)
    .maybeSingle();

  if (driverError) {
    console.error("driver lookup error", driverError.message);
    return json({ error: "invalid_credentials" }, 401);
  }

  const activeDeviceId = driverRow?.active_device_id as string | null;

  if (activeDeviceId && activeDeviceId !== deviceId && !forceOverride) {
    const { data: activeSession } = await admin
      .from("driver_device_sessions")
      .select("device_model, device_manufacturer, last_seen_at")
      .eq("driver_id", userId)
      .eq("device_id", activeDeviceId)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return json(
      {
        error: "device_conflict",
        active_device: {
          device_id: activeDeviceId,
          device_model: activeSession?.device_model ?? null,
          device_manufacturer: activeSession?.device_manufacturer ?? null,
          last_seen_at: activeSession?.last_seen_at ?? null,
        },
      },
      409,
    );
  }

  if (activeDeviceId && activeDeviceId !== deviceId && forceOverride) {
    const { error: revokeError } = await admin
      .from("driver_device_sessions")
      .update({
        revoked_at: nowIso,
        revoked_reason: "override",
        flush_deadline_at: flushDeadlineIso,
        updated_at: nowIso,
      })
      .eq("driver_id", userId)
      .eq("device_id", activeDeviceId)
      .is("revoked_at", null);

    if (revokeError) {
      console.error("revoke active session error", revokeError.message);
      return json({ error: "server_error" }, 500);
    }
  }

  const { data: existingSession } = await admin
    .from("driver_device_sessions")
    .select("id, first_seen_at")
    .eq("driver_id", userId)
    .eq("device_id", deviceId)
    .maybeSingle();

  const sessionPayload = {
    driver_id: userId,
    device_id: deviceId,
    device_model: deviceMeta.model,
    device_manufacturer: deviceMeta.manufacturer,
    os_version: deviceMeta.os_version,
    android_sdk_int: deviceMeta.android_sdk_int,
    app_version_name: deviceMeta.app_version_name,
    app_version_code: deviceMeta.app_version_code,
    first_seen_at: existingSession?.first_seen_at ?? nowIso,
    last_seen_at: nowIso,
    revoked_at: null,
    revoked_reason: null,
    flush_deadline_at: null,
    flushed_at: null,
    updated_at: nowIso,
  };

  const { data: sessionRow, error: sessionError } = await admin
    .from("driver_device_sessions")
    .upsert(sessionPayload, { onConflict: "driver_id,device_id" })
    .select("id")
    .single();

  if (sessionError || !sessionRow?.id) {
    console.error("session upsert error", sessionError?.message);
    return json({ error: "server_error" }, 500);
  }

  const { error: driverUpdateError } = await admin
    .from("drivers")
    .update({
      active_device_id: deviceId,
      active_device_session_id: sessionRow.id,
      updated_at: nowIso,
    })
    .eq("id", userId);

  if (driverUpdateError) {
    console.error("driver update error", driverUpdateError.message);
    return json({ error: "server_error" }, 500);
  }

  const { data: userData, error: userError } = await admin.auth.admin
    .getUserById(userId);

  if (userError || !userData?.user?.email) {
    console.error("getUserById error", userError?.message);
    return json({ error: "invalid_credentials" }, 401);
  }

  const email = userData.user.email;
  const existingMetadata = userData.user.user_metadata ?? {};

  const { error: metadataError } = await admin.auth.admin.updateUserById(
    userId,
    {
      user_metadata: {
        ...existingMetadata,
        device_id: deviceId,
      },
    },
  );

  if (metadataError) {
    console.error("updateUser metadata error", metadataError.message);
    return json({ error: "server_error" }, 500);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin
    .generateLink({
      type: "magiclink",
      email,
    });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("generateLink error", linkError?.message);
    return json({ error: "invalid_credentials" }, 401);
  }

  const { data: sessionData, error: verifyError } = await admin.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });

  if (verifyError || !sessionData?.session) {
    console.error("verifyOtp error", verifyError?.message);
    return json({ error: "invalid_credentials" }, 401);
  }

  const session = sessionData.session;

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user_id: userId,
    driver_code: lookup.driver_code ?? loginId,
    device_id: deviceId,
  });
});
