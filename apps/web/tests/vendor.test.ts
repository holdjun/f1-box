import { describe, expect, it } from "vitest";

import { logoVariantFor, vendorContentType } from "../src/lib/vendor.js";

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
});
