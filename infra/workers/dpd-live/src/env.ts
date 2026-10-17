export type Env = {
  FLEET: DurableObjectNamespace;
  /** Sharding key. One room per fleet; a parameter from day one. */
  FLEET_ROOM: string;
  POSITION_FRAME_HZ: string;
  POSTGRES_FLUSH_MS: string;
  /**
   * Kept so a deploy does not drop the binding. The room no longer posts a
   * broadcast; the admin 10s snapshot poll is the fallback.
   */
  BROADCAST_MIRROR_MS: string;
  /**
   * Alarm floor. Frames and flushes are driven by ingest in production
   * (500 drivers at 5s is ~100 requests/second, far above every cadence here); the
   * alarm exists for the case that matters most when ingest stops, which is
   * noticing that it stopped.
   */
  TICK_MS: string;

  SUPABASE_URL: string;
  /** Admin gate for `/refresh` and `/stats` (`x-fleet-admin-key`). Not a REST call. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  /** `https://me-central1-musallam-delivery-prod.cloudfunctions.net` */
  FIREBASE_FUNCTIONS_BASE_URL: string;
  /** Must match the Functions secret `WORKER_SHARED_SECRET`. Never a wrangler var. */
  WORKER_SHARED_SECRET: string;
  /** Firebase project that issues rider ID tokens (`musallam-delivery-prod`). */
  FIREBASE_PROJECT_ID: string;
  /** Shared with the admin app's /api/live-tracking-v2/token route. */
  ADMIN_WS_TOKEN_SECRET: string;
  /** R2 `dpd-gps-prod`. Optional so a deploy without the binding keeps working. */
  GPS_ARCHIVE?: R2Bucket;
  /** `r2` writes minute files and per-rider hourly files to `GPS_ARCHIVE`. */
  GPS_SINK?: string;
  /** 0–100: share of riders (by id hash) whose points reach the archive. */
  GPS_SINK_PERCENT?: string;
  /**
   * `1` keeps writing `driver_location_events` for archived riders too, so the
   * archive can be compared against Firestore before Firestore history stops.
   */
  GPS_DUAL_WRITE?: string;
};
