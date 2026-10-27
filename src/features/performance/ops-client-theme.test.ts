import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_THEME_BY_KEY,
  publicLogoSrc,
  resolveOpsClientTheme,
} from "./ops-client-theme";

describe("ops client theme", () => {
  it("uses Americana and Keeta palettes for a single selected client", () => {
    assert.deepEqual(resolveOpsClientTheme({ projectKeys: ["americana"] }).header, CLIENT_THEME_BY_KEY.americana.header);
    assert.equal(resolveOpsClientTheme({ projectKeys: ["keeta"] }).accent, CLIENT_THEME_BY_KEY.keeta.accent);
  });

  it("falls back to MGHub navy when all or several clients are selected", () => {
    assert.equal(resolveOpsClientTheme({ projectKeys: [] }).header, CLIENT_THEME_BY_KEY.default.header);
    assert.equal(
      resolveOpsClientTheme({ projectKeys: ["americana", "keeta"] }).header,
      CLIENT_THEME_BY_KEY.default.header,
    );
  });

  it("accepts http(s) logos and skips R2 keys", () => {
    assert.equal(publicLogoSrc("https://cdn.example/keeta.png"), "https://cdn.example/keeta.png");
    assert.equal(publicLogoSrc("partners/keeta/logo.png"), null);
    assert.equal(
      resolveOpsClientTheme({
        projectKeys: ["keeta"],
        partners: [{ key: "keeta", logo_url: "https://cdn.example/keeta.png" }],
      }).logoUrl,
      "https://cdn.example/keeta.png",
    );
  });
});
