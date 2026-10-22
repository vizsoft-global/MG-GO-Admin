/**
 * Type is served from `public/fonts/` (`src/app/fonts.css`): Gotham for Latin,
 * GE SS TWO for Arabic. No `next/font/google` import remains — the remote font
 * fetch was both a build-time dependency and the source of the Turbopack
 * import-map failure on Vercel. The alternate picks in Settings resolve through
 * the CSS stacks in `globals.css`.
 */
export const launcherFontClassName = "";

export const appFontClassName = "";
