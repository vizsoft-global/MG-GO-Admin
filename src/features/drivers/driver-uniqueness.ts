import { createClient } from "@/lib/supabase/server";

/** True when another non-archived intake or linked driver already uses this civil ID. */
export async function civilIdExists(
  civilId: string,
  excludeIntakeId?: string,
): Promise<boolean> {
  const supabase = await createClient();

  let intakeQuery = supabase
    .from("driver_intakes")
    .select("id")
    .eq("civil_id", civilId)
    .is("archived_at", null)
    .limit(1);
  if (excludeIntakeId) intakeQuery = intakeQuery.neq("id", excludeIntakeId);

  const { data: intakeHit } = await intakeQuery.maybeSingle();
  if (intakeHit) return true;

  const { data: driverHits } = await supabase
    .from("drivers")
    .select("id")
    .eq("civil_id", civilId);

  if (!driverHits?.length) return false;
  if (!excludeIntakeId) return true;

  for (const driver of driverHits) {
    const { data: linkedIntake } = await supabase
      .from("driver_intakes")
      .select("id")
      .eq("linked_profile_id", driver.id)
      .maybeSingle();
    if (linkedIntake?.id !== excludeIntakeId) return true;
  }

  return false;
}

/** True when another non-archived intake or linked driver already uses this employee ID. */
export async function employeeIdExists(
  employeeId: string,
  excludeIntakeId?: string,
): Promise<boolean> {
  const supabase = await createClient();

  let intakeQuery = supabase
    .from("driver_intakes")
    .select("id")
    .ilike("employee_id", employeeId)
    .is("archived_at", null)
    .limit(1);
  if (excludeIntakeId) intakeQuery = intakeQuery.neq("id", excludeIntakeId);

  const { data: intakeHit } = await intakeQuery.maybeSingle();
  if (intakeHit) return true;

  const { data: driverHits } = await supabase
    .from("drivers")
    .select("id")
    .ilike("employee_id", employeeId);

  if (!driverHits?.length) return false;
  if (!excludeIntakeId) return true;

  for (const driver of driverHits) {
    const { data: linkedIntake } = await supabase
      .from("driver_intakes")
      .select("id")
      .eq("linked_profile_id", driver.id)
      .maybeSingle();
    if (linkedIntake?.id !== excludeIntakeId) return true;
  }

  return false;
}
