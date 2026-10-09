import { COLLECTIONS } from "@/lib/firebase/db";
import { getFirebaseAuth, getFirebaseFirestore } from "@/lib/firebase/admin";

export type DriverAuthContext = {
  authUid: string;
  driverId: string;
};

export async function requireDriverFromRequest(
  request: Request,
): Promise<DriverAuthContext | { error: string; status: number }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "missing_token", status: 401 };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { error: "missing_token", status: 401 };
  }

  const auth = await getFirebaseAuth();
  const db = await getFirebaseFirestore();
  if (!auth || !db) {
    return { error: "not_configured", status: 503 };
  }

  let authUid: string;
  try {
    const decoded = await auth.verifyIdToken(token);
    authUid = decoded.uid;
  } catch {
    return { error: "invalid_token", status: 401 };
  }

  const profile = await db.collection(COLLECTIONS.profiles).doc(authUid).get();
  if (profile.data()?.role !== "rider") {
    return { error: "not_a_driver", status: 403 };
  }

  const driver = await db.collection(COLLECTIONS.drivers).doc(authUid).get();
  if (!driver.exists) {
    return { error: "driver_not_found", status: 403 };
  }

  if (driver.data()?.archived_at != null) {
    return { error: "driver_archived", status: 403 };
  }

  return { authUid, driverId: driver.id };
}
