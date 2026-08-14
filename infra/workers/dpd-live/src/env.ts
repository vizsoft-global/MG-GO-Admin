export type Env = {
  FLEET: DurableObjectNamespace;
  /** Sharding key. One room per fleet; a parameter from day one. */
  FLEET_ROOM: string;
  POSITION_FRAME_HZ: string;
  POSTGRES_FLUSH_MS: string;
  BROADCAST_MIRROR_MS: string;
  /**
   * Alarm floor. Frames, mirrors and flushes are driven by ingest in production
   * (500 drivers at 5s is ~100 requests/second, far above every cadence here); the
   * alarm exists for the case that matters most when ingest stops, which is
   * noticing that it stopped.
   */
  TICK_MS: string;

  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  /** Shared with the admin app's /api/live-tracking-v2/token route. */
  ADMIN_WS_TOKEN_SECRET: string;
};
