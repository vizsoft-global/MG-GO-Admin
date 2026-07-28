import { resolvePartnerLogoUrl } from "@/lib/storage/partner-logo-url";
import { signedProofUrlsForKey } from "@/lib/storage/proof-image-url";
import type { DeliveryListRow, DeliveryStatus } from "./types";

function shortId(uuid: string): string {
  return uuid.slice(0, 8).toUpperCase();
}

function relName<T extends { name: string }>(
  rel: T | T[] | null | undefined,
): string {
  if (!rel) return "—";
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.name ?? "—";
}

function parseCoord(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type DeliveryDbRowForList = {
  id: string;
  driver_id: string;
  partner_id: string | null;
  restaurant_id?: string | null;
  zone_id: string | null;
  external_order_id: string | null;
  order_proof_url: string | null;
  status: DeliveryStatus;
  rejection_reason: string | null;
  delivered_at: string | null;
  delivered_lat: number | null;
  delivered_lng: number | null;
  pickup_at: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_proof_url: string | null;
  cancelled_at: string | null;
  cancel_lat: number | null;
  cancel_lng: number | null;
  cancel_reason: string | null;
  cancel_proof_url: string | null;
  created_at: string;
  drivers: {
    driver_code: string;
    employee_id?: string | null;
    profiles:
      | { full_name: string | null; phone: string | null }
      | { full_name: string | null; phone: string | null }[]
      | null;
  } | {
    driver_code: string;
    employee_id?: string | null;
    profiles:
      | { full_name: string | null; phone: string | null }
      | { full_name: string | null; phone: string | null }[]
      | null;
  }[] | null;
  partners:
    | { name: string; logo_url: string | null }
    | { name: string; logo_url: string | null }[]
    | null;
  restaurants?:
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
  zones: { name: string } | { name: string }[] | null;
};

/**
 * Map raw delivery rows to list rows.
 *
 * Proof image URLs are signed locally (HMAC, no R2 presign). Partner logos
 * resolve only when `resolveAssets` is true.
 */
export async function mapDeliveryDbRowsToListRows(
  rows: DeliveryDbRowForList[],
  gpsMockFlags: Map<string, boolean> = new Map(),
  options: { resolveAssets?: boolean } = {},
): Promise<DeliveryListRow[]> {
  const resolveAssets = options.resolveAssets ?? true;
  const partnerLogoCache = new Map<string, string | null>();

  return Promise.all(
    rows.map(async (row) => {
      const driverRel = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
      const profileRel = driverRel?.profiles;
      const profile = Array.isArray(profileRel) ? profileRel[0] : profileRel;

      const partnerRel = Array.isArray(row.partners) ? row.partners[0] : row.partners;
      const partnerLogoKey = partnerRel?.logo_url ?? null;

      let partner_logo_url: string | null = null;
      if (resolveAssets && partnerLogoKey) {
        if (partnerLogoCache.has(partnerLogoKey)) {
          partner_logo_url = partnerLogoCache.get(partnerLogoKey) ?? null;
        } else {
          partner_logo_url = await resolvePartnerLogoUrl(partnerLogoKey);
          partnerLogoCache.set(partnerLogoKey, partner_logo_url);
        }
      }

      const deliveryProof = signedProofUrlsForKey(row.order_proof_url);
      const pickupProof = signedProofUrlsForKey(row.pickup_proof_url);
      const cancelProof = signedProofUrlsForKey(row.cancel_proof_url);

      return {
        id: row.id,
        short_id: shortId(row.id),
        driver_id: row.driver_id,
        driver_name: profile?.full_name ?? "—",
        driver_code: driverRel?.driver_code ?? "—",
        driver_employee_id: driverRel?.employee_id ?? "—",
        driver_phone: profile?.phone ?? "—",
        partner_id: row.partner_id,
        partner_name: relName(row.partners),
        partner_logo_url,
        restaurant_id: row.restaurant_id ?? null,
        restaurant_name: (() => {
          const rel = Array.isArray(row.restaurants) ? row.restaurants[0] : row.restaurants;
          return rel?.name ?? null;
        })(),
        zone_id: row.zone_id,
        zone_name: relName(row.zones),
        status: row.status,
        external_order_id: row.external_order_id,
        order_proof_url: row.order_proof_url,
        proof_display_url: deliveryProof.thumbUrl,
        proof_full_url: deliveryProof.fullUrl,
        proof_content_type: deliveryProof.contentType,
        pickup_at: row.pickup_at,
        pickup_lat: parseCoord(row.pickup_lat),
        pickup_lng: parseCoord(row.pickup_lng),
        pickup_proof_url: row.pickup_proof_url,
        pickup_proof_display_url: pickupProof.thumbUrl,
        pickup_proof_full_url: pickupProof.fullUrl,
        pickup_proof_content_type: pickupProof.contentType,
        cancelled_at: row.cancelled_at,
        cancel_lat: parseCoord(row.cancel_lat),
        cancel_lng: parseCoord(row.cancel_lng),
        cancel_reason: row.cancel_reason,
        cancel_proof_url: row.cancel_proof_url,
        cancel_proof_display_url: cancelProof.thumbUrl,
        cancel_proof_full_url: cancelProof.fullUrl,
        cancel_proof_content_type: cancelProof.contentType,
        rejection_reason: row.rejection_reason,
        delivered_at: row.delivered_at,
        delivered_lat: parseCoord(row.delivered_lat),
        delivered_lng: parseCoord(row.delivered_lng),
        created_at: row.created_at,
        gps_is_mocked: gpsMockFlags.get(row.id) ?? false,
      };
    }),
  );
}
