import { setGlobalOptions } from "firebase-functions/v2";
import { getApps, initializeApp } from "firebase-admin/app";

/**
 * Must load before any `onCall()` module. `export { fn } from "./rpcs/..."`
 * evaluates those files first unless this module is imported above them —
 * without that, v2 defaults every callable to us-central1.
 */
setGlobalOptions({ region: "me-central2", maxInstances: 20 });

if (getApps().length === 0) {
  initializeApp();
}
