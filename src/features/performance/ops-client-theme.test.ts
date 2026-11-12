import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_THEME_BY_KEY,
  OPS_CLIENT_PALETTES,
  opsRampColorFor,
  opsThemeStyleVars,
  publicLogoSrc,
  resolveOpsClientTheme,
} from "./ops-client-theme";

describe("ops client theme", () => {
  it("gives Americana the blue palette and Keeta the gold one", () => {
    // The client's reference dashboards: Americana blue, Keeta gold. The old
    // module used Americana brand red and Keeta orange, which is what the review
    // notes flagged.
    const americana = resolveOpsClientTheme({ projectKeys: ["americana"] });
    const keeta = resolveOpsClientTheme({ projectKeys: ["keeta"] });
    assert.equal(americana.key, "americana");
    assert.equal(keeta.key, "keeta");
    assert.equal(americana.palette.ink, "#2060b0");
    assert.equal(keeta.palette.ink, "#a8891a");
    // A blue must actually be blue: more blue than red.
    const [r, g, b] = [
      Number.parseInt(americana.palette.ink.slice(1, 3), 16),
      Number.parseInt(americana.palette.ink.slice(3, 5), 16),
      Number.parseInt(americana.palette.ink.slice(5, 7), 16),
    ];
    assert.ok(b > r && b > g, "Americana ink must be blue-dominant");
  });

  it("falls back to the neutral slate when all or several clients are selected", () => {
    assert.equal(resolveOpsClientTheme({ projectKeys: [] }).key, "all");
    assert.equal(
      resolveOpsClientTheme({ projectKeys: ["americana", "keeta"] }).key,
      "all",
    );
    assert.equal(
      resolveOpsClientTheme({ projectKeys: [] }).palette.ink,
      OPS_CLIENT_PALETTES.all.ink,
    );
  });

  it("keeps each palette at seven ramp steps, darkest first", () => {
    for (const palette of Object.values(OPS_CLIENT_PALETTES)) {
      assert.equal(palette.ramp.length, 7);
      // Darkest to lightest: luminance must not increase as the index falls.
      const lum = (hex: string) =>
        Number.parseInt(hex.slice(1, 3), 16) +
        Number.parseInt(hex.slice(3, 5), 16) +
        Number.parseInt(hex.slice(5, 7), 16);
      assert.ok(lum(palette.ramp[0]!) < lum(palette.ramp[6]!));
    }
  });

  it("exposes every token the page paints from", () => {
    const vars = opsThemeStyleVars(OPS_CLIENT_PALETTES.americana);
    for (const key of ["--ops-bg", "--ops-title", "--ops-ink", "--ops-soft", "--ops-line"]) {
      assert.equal(typeof vars[key], "string", `${key} must be set`);
    }
    for (let step = 1; step <= 7; step += 1) {
      assert.equal(typeof vars[`--ops-c${step}`], "string");
    }
    // Legacy aliases stay, so an old call site keeps a themed colour.
    assert.equal(vars["--ops-header"], OPS_CLIENT_PALETTES.americana.title);
    assert.equal(vars["--ops-accent"], OPS_CLIENT_PALETTES.americana.ink);
  });

  it("accepts http(s) logos and rejects an R2 object key", () => {
    assert.equal(publicLogoSrc("https://cdn.example/keeta.png"), "https://cdn.example/keeta.png");
    // A key is not a URL; the action signs it before it reaches this module.
    assert.equal(publicLogoSrc("partners/keeta/logo.png"), null);
    assert.equal(
      resolveOpsClientTheme({
        projectKeys: ["keeta"],
        partners: [{ key: "keeta", logo_url: "https://cdn.example/keeta.png" }],
      }).logoUrl,
      "https://cdn.example/keeta.png",
    );
  });

  it("keeps the legacy colour map in the theme's own family", () => {
    assert.equal(CLIENT_THEME_BY_KEY.americana.header, OPS_CLIENT_PALETTES.americana.title);
    assert.equal(CLIENT_THEME_BY_KEY.keeta.accent, OPS_CLIENT_PALETTES.keeta.ink);
    assert.equal(CLIENT_THEME_BY_KEY.default.header, OPS_CLIENT_PALETTES.all.title);
  });
});

describe("opsRampColorFor", () => {
  it("puts the darkest step on the top of a ranking", () => {
    const palette = OPS_CLIENT_PALETTES.americana;
    assert.equal(opsRampColorFor(palette, 0, 6), `var(--ops-c1, ${palette.ramp[0]})`);
  });

  it("lightens toward the bottom of a ranking", () => {
    const palette = OPS_CLIENT_PALETTES.americana;
    assert.equal(opsRampColorFor(palette, 5, 6), `var(--ops-c7, ${palette.ramp[6]})`);
  });

  it("gives a single bar the second step, not the darkest", () => {
    // One category should not read as "the only good one".
    const palette = OPS_CLIENT_PALETTES.americana;
    assert.equal(opsRampColorFor(palette, 0, 1), `var(--ops-c2, ${palette.ramp[1]})`);
  });
});
