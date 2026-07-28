"use server";

import { createClient } from "@/lib/supabase/server";

export async function updateProfile(
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!fullName) {
    return { error: "missing_name" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "not_authenticated" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone: phone || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return { error: "save_failed" };
  }

  return { success: true };
}
