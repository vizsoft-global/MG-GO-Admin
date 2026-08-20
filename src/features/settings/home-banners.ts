export const HOME_BANNER_PREFIX = "home-banners";

export type HomeBannerRow = {
  id: string;
  image_object_key: string;
  image_url: string;
  caption_en: string | null;
  caption_ar: string | null;
  deep_link: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  sort_order: number;
  zone_ids: string[];
  partner_ids: string[];
  driver_group_ids: string[];
};

export type HomeBannerOption = { id: string; name: string };

export type HomeBannerLookups = {
  zones: HomeBannerOption[];
  partners: HomeBannerOption[];
  groups: HomeBannerOption[];
};
