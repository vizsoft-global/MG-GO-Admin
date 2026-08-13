import { createAdminClient } from "@/lib/supabase/admin";

/** Keep profiles.avatar_url, drivers.avatar_object_key, and linked intake in lockstep. */
export async function syncDriverAvatarKey(
  driverId: string,
  objectKey: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const key = objectKey?.trim() || null;

  await Promise.all([
    admin
      .from("drivers")
      .update({
        avatar_object_key: key,
        avatar_updated_at: now,
        updated_at: now,
      })
      .eq("id", driverId),
    admin
      .from("profiles")
      .update({
        avatar_url: key,
        updated_at: now,
      })
      .eq("id", driverId),
    admin
      .from("driver_intakes")
      .update({
        avatar_url: key,
        updated_at: now,
      })
      .eq("linked_profile_id", driverId),
  ]);
}
