export type AppReleaseChannel = "production" | "beta" | "internal";

export type AppReleaseRow = {
  id: string;
  platform: string;
  channel: AppReleaseChannel;
  version_name: string;
  version_code: number;
  min_supported_version_code: number | null;
  apk_object_key: string;
  apk_size_bytes: number;
  apk_sha256: string;
  release_notes: string | null;
  is_required: boolean;
  is_active: boolean;
  released_at: string;
  released_by: string | null;
};

export type AppReleaseAdoptionRow = {
  version_code: number | null;
  version_name: string;
  driver_count: number;
  percent: number;
  is_active: boolean;
  is_known_release: boolean;
};

export type AppReleaseAdoptionResult = {
  total_drivers: number;
  active_version_code: number | null;
  items: AppReleaseAdoptionRow[];
};

export type AppReleaseDriverRow = {
  driver_id: string;
  driver_code: string;
  full_name: string | null;
  phone: string | null;
  partner_name: string | null;
  version_name: string | null;
  version_code: number | null;
  app_version_seen_at: string | null;
};

export type AppReleaseDriversPage = {
  total: number;
  limit: number;
  offset: number;
  items: AppReleaseDriverRow[];
};

export type AppReleaseMutationResult =
  | { ok: true; release: AppReleaseRow }
  | { ok: false; error: string };

export type AppReleasesListResult =
  | { ok: true; items: AppReleaseRow[] }
  | { ok: false; error: string };

export type AppReleaseAdoptionQueryResult =
  | { ok: true; data: AppReleaseAdoptionResult }
  | { ok: false; error: string };

export type AppReleaseDriversQueryResult =
  | { ok: true; data: AppReleaseDriversPage }
  | { ok: false; error: string };
