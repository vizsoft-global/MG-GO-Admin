import type { LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";

/**
 * Shared module hub — Figma `7267:23538` (BajajCare, "03 · Visit bookings").
 *
 * One shell for Visit bookings, Fleet Hub, Payroll Hub and OperationsHub so the
 * four doors into the panel cannot drift: dark gradient canvas, a beige 64px
 * title tile, an optional stat strip, optional filter pills, and glass panels of
 * beige module tiles.
 *
 * Three things are stated here because the shell can inherit none of them:
 *
 *  * **Weights.** `globals.css` maps `--font-weight-medium` / `-semibold` to 400,
 *    so `font-medium` and `font-semibold` flatten the design's 500/600 to
 *    regular. Figtree's three weights are written as arbitrary properties.
 *  * **Radii.** `--radius` is 0.5rem, making `rounded-3xl` 17.6px; the design's
 *    16 / 18 / 24 / 32px are arbitrary values here.
 *  * **Headings.** `p` is pinned to 400 and `h1`–`h3` are re-sized globally, so
 *    headings are `div role="heading"` and bold body copy is `span`.
 *
 * No hooks and no `"use client"`: this renders from a server page and from a
 * client page alike, and the only stateful thing on any hub is its data.
 */

/**
 * The glyph palette the Figma tile component names as "muted". Every module
 * glyph inside a beige tile is drawn in one of these, never in white.
 */
export const HUB_GLYPH_TINTS = {
  teal: "#2F6E7E",
  rose: "#8A2F52",
  rust: "#C2462B",
  navy: "#3E4D7A",
  gold: "#C08418",
  olive: "#5E7A3A",
  brown: "#6B4A3A",
} as const;

export type HubGlyphTint = (typeof HUB_GLYPH_TINTS)[keyof typeof HUB_GLYPH_TINTS];

export type HubTile = {
  href: string;
  label: string;
  /** Lucide glyph, drawn inside the beige tile. */
  icon?: LucideIcon;
  /**
   * Exported Figma SVG for this exact module, preferred over `icon`. Used where
   * the design ships a glyph (the Visit bookings hub); the other hubs compose
   * their tiles from the same Lucide set the sidebar already uses.
   */
  glyph?: string;
  /** Which muted colour the glyph takes. Defaults to `navy`. */
  tint?: HubGlyphTint;
  /** Red count chip, drawn only where the hub has a real queue behind it. */
  badge?: number;
  /** What the count is, for assistive tech. Required whenever `badge` is set. */
  badgeLabel?: string;
  /** A count the design shows elsewhere, kept on the link for screen readers. */
  srCountLabel?: string;
};

export type HubGroup = {
  id: string;
  heading: string;
  hint: string;
  tiles: HubTile[];
};

export type HubStat = {
  /** `/visit-hub/icon-…svg` — a white stroke on transparent, as the design draws it. */
  icon: string;
  value: string;
  label: string;
};

export type HubPill = { label: string; href: string; active?: boolean };

export type HubPills = {
  heading: string;
  hint: string;
  items: HubPill[];
};

/** The title tile glyph: a Lucide icon, or an exported Figma glyph. */
export type HubTitleTile = { icon?: LucideIcon; glyph?: string; tint?: HubGlyphTint };

function Tile({ tile }: { tile: HubTile }) {
  const Icon = tile.icon;
  return (
    <Link
      href={tile.href}
      className="group flex w-[124px] shrink-0 flex-col items-center gap-3 outline-none focus-visible:rounded-[18px] focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <span className="relative block size-16 shrink-0">
        <span className="absolute inset-0 flex items-center justify-center rounded-[18px] bg-gradient-to-b from-[#f3ede7] to-[#d5cbc2] drop-shadow-[0_6px_7px_rgba(0,0,0,0.35)]">
          {tile.glyph ? (
            <img src={tile.glyph} alt="" width={28} height={28} className="block" />
          ) : Icon ? (
            <Icon
              className="size-7"
              style={{ color: tile.tint ?? HUB_GLYPH_TINTS.navy }}
              strokeWidth={1.6}
              aria-hidden
            />
          ) : null}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.75)]"
          />
        </span>
        {tile.badge != null && tile.badge > 0 ? (
          <span className="absolute -end-[7px] -top-[7px] inline-flex min-w-[20px] items-center justify-center rounded-full bg-[#d9472b] px-[7px] py-[2px] drop-shadow-[0_2px_2px_rgba(217,71,43,0.25)]">
            <span className="text-[11px] leading-[normal] [font-weight:700] text-white">
              {tile.badge > 99 ? "99+" : tile.badge}
            </span>
          </span>
        ) : null}
      </span>
      <span className="w-[124px] text-center text-[14px] leading-[normal] [font-weight:500] text-white">
        {tile.label}
      </span>
      {tile.badge != null && tile.badge > 0 && tile.badgeLabel ? (
        <span className="sr-only">{tile.badgeLabel}</span>
      ) : null}
      {tile.srCountLabel ? <span className="sr-only">{tile.srCountLabel}</span> : null}
    </Link>
  );
}

function Panel({ group }: { group: HubGroup }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-7 rounded-[32px] border border-white/[0.09] bg-white/[0.05] px-8 pb-8 pt-7 shadow-[0_20px_40px_0_rgba(0,0,0,0.18)] backdrop-blur-[6.75px]">
      <div className="flex items-center gap-[10px]">
        <div
          role="heading"
          aria-level={2}
          className="text-[12px] leading-[normal] [font-weight:700] tracking-[1.6px] whitespace-nowrap text-white/60"
        >
          {group.heading}
        </div>
        <img src="/visit-hub/dot.svg" alt="" width={4} height={4} className="block shrink-0" />
        <span className="text-[13px] leading-[normal] whitespace-nowrap text-white/50">
          {group.hint}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {group.tiles.map((tile) => (
          <Tile key={tile.href} tile={tile} />
        ))}
      </div>
    </section>
  );
}

function Stat({ stat }: { stat: HubStat }) {
  return (
    <div className="flex items-center gap-[10px]">
      <img src={stat.icon} alt="" width={20} height={20} className="block shrink-0" />
      <div className="flex flex-col items-start">
        <span className="text-[15px] leading-[normal] [font-weight:600] whitespace-nowrap text-white">
          {stat.value}
        </span>
        <span className="text-[11px] leading-[normal] whitespace-nowrap text-white/50">
          {stat.label}
        </span>
      </div>
    </div>
  );
}

export function AppHubShell({
  title,
  subtitle,
  breadcrumbHome,
  breadcrumbHref = "/dashboard",
  titleTile,
  stats,
  pills,
  groups,
}: {
  title: string;
  subtitle: string;
  breadcrumbHome: string;
  breadcrumbHref?: string;
  titleTile: HubTitleTile;
  stats?: HubStat[];
  pills?: HubPills;
  groups: HubGroup[];
}) {
  const TitleIcon = titleTile.icon;

  return (
    <div className="relative isolate -m-3 flex min-h-[calc(100%+1.5rem)] flex-col overflow-hidden bg-gradient-to-b from-[#2f2f47] to-[#242437] px-6 pb-5 pt-[50px] lg:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[69px] -end-[21px] -scale-y-100 select-none"
      >
        <img src="/visit-hub/watermark.svg" alt="" width={333} height={396} className="block" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[1128px] flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex flex-col gap-[14px]">
            <nav aria-label={breadcrumbHome} className="flex items-center gap-[6px]">
              <img src="/visit-hub/icon-home.svg" alt="" width={14} height={14} className="block" />
              <Link
                href={breadcrumbHref}
                className="text-[13px] leading-[normal] [font-weight:500] whitespace-nowrap text-white/55 transition-colors duration-150 hover:text-white/80 motion-reduce:transition-none"
              >
                {breadcrumbHome}
              </Link>
              <img
                src="/visit-hub/icon-caret-right.svg"
                alt=""
                width={14}
                height={14}
                className="block"
              />
              <span className="text-[13px] leading-[normal] [font-weight:600] whitespace-nowrap text-white/95">
                {title}
              </span>
            </nav>

            <div className="flex items-center gap-4">
              <span className="relative flex size-16 shrink-0 items-center justify-center">
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-[18px] bg-gradient-to-b from-[#f3ede7] to-[#d5cbc2] drop-shadow-[0_6px_7px_rgba(0,0,0,0.35)]"
                />
                {titleTile.glyph ? (
                  <img
                    src={titleTile.glyph}
                    alt=""
                    width={28}
                    height={28}
                    className="relative block"
                  />
                ) : TitleIcon ? (
                  <TitleIcon
                    className="relative size-7"
                    style={{ color: titleTile.tint ?? HUB_GLYPH_TINTS.navy }}
                    strokeWidth={1.6}
                    aria-hidden
                  />
                ) : null}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-[18px] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.75)]"
                />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <div
                  role="heading"
                  aria-level={1}
                  className="text-[30px] leading-[normal] [font-weight:700] text-white"
                >
                  {title}
                </div>
                <span className="text-[14px] leading-[normal] text-white/60">{subtitle}</span>
              </div>
            </div>
          </div>

          {stats && stats.length > 0 ? (
            <div className="flex flex-wrap items-center gap-5 rounded-[16px] border border-white/[0.08] bg-white/[0.04] px-5 py-3">
              {stats.map((stat, index) => (
                <div key={stat.label} className="flex items-center gap-5">
                  {index > 0 ? (
                    <span aria-hidden className="h-7 w-px shrink-0 bg-white/[0.14]" />
                  ) : null}
                  <Stat stat={stat} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {pills && pills.items.length > 0 ? (
          <section className="flex flex-col gap-4 rounded-[24px] border border-white/[0.08] bg-white/[0.04] px-7 py-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div
                role="heading"
                aria-level={2}
                className="text-[12px] leading-[normal] [font-weight:700] tracking-[1.4px] whitespace-nowrap text-white/55"
              >
                {pills.heading}
              </div>
              <span className="text-[12px] leading-[normal] text-white/45">{pills.hint}</span>
            </div>
            <div className="flex flex-wrap gap-[10px]">
              {pills.items.map((pill) =>
                pill.active ? (
                  <span
                    key={pill.href}
                    aria-current="page"
                    className="inline-flex items-center rounded-full bg-gradient-to-b from-[#f3ede7] to-[#dcd2c9] px-4 py-2 text-[13px] leading-[normal] [font-weight:600] whitespace-nowrap text-[#2c2c43] drop-shadow-[0_3px_4px_rgba(0,0,0,0.3)]"
                  >
                    {pill.label}
                  </span>
                ) : (
                  <Link
                    key={pill.href}
                    href={pill.href}
                    className="inline-flex items-center rounded-full border border-white/[0.14] bg-white/[0.05] px-4 py-2 text-[13px] leading-[normal] [font-weight:500] whitespace-nowrap text-[#dcdae6] transition-colors duration-150 hover:bg-white/[0.1] motion-reduce:transition-none"
                  >
                    {pill.label}
                  </Link>
                ),
              )}
            </div>
          </section>
        ) : null}

        <div className="flex flex-col gap-6 xl:flex-row xl:items-stretch">
          {groups.map((group) => (
            <Panel key={group.id} group={group} />
          ))}
        </div>

        <div aria-hidden className="min-h-px flex-1" />
      </div>
    </div>
  );
}
