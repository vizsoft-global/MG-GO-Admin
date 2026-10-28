import { getAppSettings } from "@/lib/branding/get-app-settings";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { resolveSourceCompanyLogoUrl } from "@/features/drivers/source-company-logo";

/**
 * One resolver per send / batch call.
 *
 * A workforce document belongs to the rider's employer, not to the panel, so the
 * header prints the rider's sponsorship logo when that sponsor has one, then the
 * source company's own logo, and falls back to the MG branding logo only when
 * neither has a mark. The catalog rows and their presigned
 * URLs are read once per call — a 100-row batch must not presign the same object
 * a hundred times — and the driver's company is cached per driver id.
 */
export type EsignSheetLogoResolver = {
  forDriver(driverId: string | null | undefined): Promise<string | null>;
};

type CompanyLogo = { logoUrl: string | null };

async function brandLogoUrl(): Promise<string | null> {
  try {
    const settings = await getAppSettings();
    return settings.logoUrl ?? null;
  } catch {
    return null;
  }
}

export async function createEsignSheetLogoResolver(): Promise<EsignSheetLogoResolver> {
  const brand = await brandLogoUrl();
  let companies: Map<string, CompanyLogo> | null = null;
  let sponsors: Map<string, string | null> | null = null;
  let systemKey: string | null = null;
  const displayUrls = new Map<string, Promise<string | null>>();
  const byDriver = new Map<string, Promise<string | null>>();

  async function loadCompanies(): Promise<Map<string, CompanyLogo>> {
    if (companies) return companies;
    const map = new Map<string, CompanyLogo>();
    companies = map;
    try {
      const db = await staffDb();
      if (!db) return map;
      const snap = await db.collection(COLLECTIONS.sourceCompanies).get();
      for (const doc of snap.docs) {
        const data = doc.data();
        const key = String(data.key ?? doc.id);
        map.set(key, { logoUrl: (data.logo_url as string | null) ?? null });
        if (data.is_system === true && !systemKey) systemKey = key;
      }
    } catch {
      /* an unreadable catalogue must not block a send */
    }
    return map;
  }

  async function loadSponsors(): Promise<Map<string, string | null>> {
    if (sponsors) return sponsors;
    const map = new Map<string, string | null>();
    sponsors = map;
    try {
      const db = await staffDb();
      if (!db) return map;
      const snap = await db.collection(COLLECTIONS.sponsorships).get();
      for (const doc of snap.docs) {
        const data = doc.data();
        const key = String(data.key ?? doc.id);
        map.set(key, (data.logo_url as string | null) ?? null);
      }
    } catch {
      /* an unreadable catalogue must not block a send */
    }
    return map;
  }

  function displayUrl(key: string, logo: string | null): Promise<string | null> {
    if (!logo) return Promise.resolve(null);
    const cached = displayUrls.get(key);
    if (cached) return cached;
    const pending = resolveSourceCompanyLogoUrl(logo).catch(() => null);
    displayUrls.set(key, pending);
    return pending;
  }

  async function resolveDriver(driverId: string): Promise<string | null> {
    try {
      const db = await staffDb();
      if (!db) return brand;
      const snap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
      if (!snap.exists) return brand;
      const data = snap.data() ?? {};
      const sponsorKey = data.sponsorship_key != null ? String(data.sponsorship_key) : "";
      if (sponsorKey) {
        const sponsorLogo = (await loadSponsors()).get(sponsorKey) ?? null;
        const printed = await displayUrl(`sponsor:${sponsorKey}`, sponsorLogo);
        if (printed) return printed;
      }
      const map = await loadCompanies();
      const own = data.source_company != null ? String(data.source_company) : "";
      const key = own || ((data.rider_category ?? "in_house") === "in_house" ? systemKey : null);
      if (!key) return brand;
      const logo = map.get(key)?.logoUrl ?? null;
      return (await displayUrl(key, logo)) ?? brand;
    } catch {
      return brand;
    }
  }

  return {
    forDriver(driverId) {
      const id = String(driverId ?? "").trim();
      if (!id) return Promise.resolve(brand);
      const cached = byDriver.get(id);
      if (cached) return cached;
      const pending = resolveDriver(id);
      byDriver.set(id, pending);
      return pending;
    },
  };
}
