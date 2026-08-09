import { describe, expect, it } from "vitest";

import {
  getVendorIndexes,
  logoVariantFor,
  vendorContentType,
  type VendorStore,
} from "../src/lib/vendor.js";

describe("vendorContentType", () => {
  it("serves common logo formats with image MIME types", () => {
    expect(vendorContentType("team-logos/stewart@1997.jpg")).toBe("image/jpeg");
    expect(vendorContentType("team-logos/vanwall@1954.jpeg")).toBe("image/jpeg");
    expect(vendorContentType("team-logos/ferrari@2026.svg")).toBe("image/svg+xml");
    expect(vendorContentType("team-logos/ferrari@2026.webp")).toBe("image/webp");
  });

  it("uses a binary fallback for unknown extensions", () => {
    expect(vendorContentType("other/archive.bin")).toBe("application/octet-stream");
  });

  it("preserves the selected logo variant for page styling", () => {
    const indexes = {
      colors: null,
      logos: [
        { file: "team-logos/ferrari@2026.webp", yearFrom: 2026, variant: "white" as const },
        { file: "team-logos/arrows@1978.png", yearFrom: 1978, variant: "color" as const },
      ],
    };

    expect(logoVariantFor(indexes, "ferrari")).toBe("white");
    expect(logoVariantFor(indexes, "arrows")).toBe("color");
    expect(logoVariantFor(indexes, "unknown")).toBeNull();
  });

  it("prefers preview logo overrides while retaining base vendor data", async () => {
    const base: VendorStore = {
      async get(key) {
        if (key === "vendor/team-colors/team-colors.json") {
          return { text: async () => JSON.stringify({ teams: { ferrari: { colors: ["#dc0000"] } } }) };
        }
        return {
          text: async () => JSON.stringify({
            logos: [{ file: "team-logos/ferrari@2026.webp", yearFrom: 2026, variant: "white" }],
          }),
        };
      },
    };
    const preview: VendorStore = {
      async get(key) {
        if (key !== "vendor/team-logos/logos.json") return null;
        return {
          text: async () => JSON.stringify({
            logos: [{ file: "team-logos/ferrari@2026.png", yearFrom: 2026, variant: "color" }],
          }),
        };
      },
    };

    const indexes = await getVendorIndexes(base, preview);
    expect(indexes.colors?.ferrari.colors).toEqual(["#dc0000"]);
    expect(indexes.logos?.[0].file).toBe("team-logos/ferrari@2026.png");
    expect(indexes.logos?.[0].variant).toBe("color");
  });
});
