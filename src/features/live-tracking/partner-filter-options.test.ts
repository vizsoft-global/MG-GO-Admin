import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPartnerFilterOptions } from "./partner-filter-options";

describe("buildPartnerFilterOptions", () => {
  it("lists every Partner-module row, including partners with zero drivers", () => {
    const options = buildPartnerFilterOptions(
      [
        { id: "1", name: "DoorDash" },
        { id: "2", name: "Keeta" },
        { id: "3", name: "Talabat" },
        { id: "4", name: "Uber Eats" },
      ],
      "All partners",
    );
    assert.deepEqual(
      options.map((o) => o.label),
      ["All partners", "DoorDash", "Keeta", "Talabat", "Uber Eats"],
    );
  });
});
