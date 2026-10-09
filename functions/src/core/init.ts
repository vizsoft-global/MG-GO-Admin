import { setGlobalOptions } from "firebase-functions/v2";
import { getApps, initializeApp } from "firebase-admin/app";

/**
 * Must load before any `onCall()` module. `export { fn } from "./rpcs/..."`
 * evaluates those files first unless this module is imported above them —
 * without that, v2 defaults every callable to us-central1.
 */
/**
 * Cloud Functions gen2 rejects uploads to me-central2 on this project
 * (`PERMISSION_DENIED` on generateUploadUrl). me-central1 (Doha) is the
 * nearest region that accepts a source upload; Firestore stays on the named
 * `default` database in me-central2.
 */
export const FUNCTIONS_REGION = "me-central1";

setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 20 });

if (getApps().length === 0) {
  initializeApp();
}
