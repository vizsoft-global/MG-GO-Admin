import type { AdminApprovalStatus } from "@/lib/auth/permissions";

/**
 * Firestore document shapes the admin panel reads.
 *
 * These replace the generated `src/types/database.ts` rows for the auth and
 * permissions path. Field names match the SQL columns deliberately: the data
 * load keeps column names as document fields, so a renamed key here is the only
 * way a value goes silently missing.
 */

export type ProfileRole = "rider" | "staff";

export type ProfileDoc = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  /** `rider` or `staff`. */
  role: ProfileRole;
  locale: string;
  /** `manager` | `user` | null — the per-user access kind. */
  access_kind: string | null;
  admin_role_id: string | null;
  approval_status: AdminApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  archived_at: string | null;
  staff_department: string | null;
  company_id: string | null;
  zone_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminRoleDoc = {
  id: string;
  slug: string;
  name: string;
  is_system: boolean;
  is_super_admin: boolean;
};

/**
 * Permission junction, denormalised to one array doc per role/user.
 *
 * The SQL junction tables are one row per (role, slug); at current volume that
 * is a N-read session load in Firestore. One doc carrying `permission_slugs`
 * makes every session load exactly one read per role (or per user) regardless
 * of how many slugs it holds.
 */
export type PermissionArrayDoc = {
  permission_slugs: string[];
};

export type PermissionCatalogDoc = {
  slugs: string[];
};
