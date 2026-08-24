import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  colorForYear,
  getTeamBranding,
  latestColor,
  logoSrcFor,
  logoVariantFor,
  vendorIndexes,
  type VendorIndexes,
} from "../src/lib/vendor.js";

const logoDir = fileURLToPath(new URL("../public/vendor/team-logos", import.meta.url));

describe("curated vendor data", () => {
  it("serves the curated Ferrari branding from repo data", () => {
    const branding = getTeamBranding(vendorIndexes, "ferrari");
    expect(branding.logoSrc).toBe("/vendor/team-logos/ferrari@2026.webp");
    expect(branding.logoVariant).toBe("white");
    expect(branding.colors[0]).toBe("#e80020");
  });

  it("falls back to monogram data for teams without a curated logo", () => {
    expect(logoSrcFor(vendorIndexes, "fittipaldi")).toBeNull();
    expect(logoVariantFor(vendorIndexes, "fittipaldi")).toBeNull();
    // fittipaldi 有策展色但无 logo：品牌色仍可用
    expect(latestColor(vendorIndexes, "fittipaldi")).toBe("#FFD700");
    // adams 两者皆无
    expect(logoSrcFor(vendorIndexes, "adams")).toBeNull();
    expect(latestColor(vendorIndexes, "adams")).toBeNull();
  });
});

describe("logo and color selection", () => {
  const indexes: VendorIndexes = {
    colors: {
      ferrari: {
        colors: ["#dc0000"],
        periods: [
          { from: 2018, to: 2020, colors: ["#aaaaaa"] },
          { from: 2021, to: null, colors: ["#dc0000"] },
        ],
      },
    },
    logos: [
      { file: "team-logos/ferrari@1990.png", yearFrom: 1990, variant: "color" },
      { file: "team-logos/ferrari@2026.webp", yearFrom: 2026, variant: "white" },
      { file: "team-logos/arrows@1978.png", yearFrom: 1978, variant: "color" },
    ],
  };

  it("picks the newest logo for a team", () => {
    expect(logoSrcFor(indexes, "ferrari")).toBe("/vendor/team-logos/ferrari@2026.webp");
    expect(logoVariantFor(indexes, "ferrari")).toBe("white");
    expect(logoSrcFor(indexes, "arrows")).toBe("/vendor/team-logos/arrows@1978.png");
    expect(logoSrcFor(indexes, "unknown")).toBeNull();
  });

  it("returns the latest curated colors", () => {
    expect(latestColor(indexes, "ferrari")).toBe("#dc0000");
    expect(latestColor(indexes, "unknown")).toBeNull();
  });

  it("picks the color period containing the year", () => {
    expect(colorForYear(indexes, "ferrari", 2019)).toBe("#aaaaaa");
    expect(colorForYear(indexes, "ferrari", 2022)).toBe("#dc0000");
    // 早于最早 period 回落最老配色；车队缺失回落 null
    expect(colorForYear(indexes, "ferrari", 2000)).toBe("#aaaaaa");
    expect(colorForYear(indexes, "unknown", 2020)).toBeNull();
  });

  it("tracks real period colors by year", () => {
    expect(colorForYear(vendorIndexes, "williams", 2020)).toBe("#0082fa");
    expect(colorForYear(vendorIndexes, "williams", 2021)).toBe("#005aff");
  });
});

describe("repo asset integrity", () => {
  it("has a non-empty file for every indexed logo and no orphan files", () => {
    const files = new Set(readdirSync(logoDir));
    for (const entry of vendorIndexes.logos) {
      const name = entry.file.replace(/^team-logos\//, "");
      const path = `${logoDir}/${name}`;
      expect(files.has(name), `missing logo asset: ${entry.file}`).toBe(true);
      expect(statSync(path).size, `empty logo asset: ${entry.file}`).toBeGreaterThan(0);
      files.delete(name);
    }
    expect([...files], "logo assets missing from logos.json").toEqual([]);
  });

  it("indexes only known logo variants", () => {
    for (const entry of vendorIndexes.logos) {
      expect(["color", "white", "mono"]).toContain(entry.variant);
    }
  });

  it("curates colors as hex values", () => {
    for (const [teamId, team] of Object.entries(vendorIndexes.colors)) {
      for (const color of team.colors) {
        expect(color, `${teamId} latest color`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      for (const period of team.periods) {
        for (const color of period.colors) {
          expect(color, `${teamId} period color`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it("has a flag asset for every curated alpha-2 code shape", () => {
    const flagDir = fileURLToPath(new URL("../public/vendor/country-flags", import.meta.url));
    expect(existsSync(`${flagDir}/it.svg`)).toBe(true);
    expect(existsSync(`${flagDir}/gb.svg`)).toBe(true);
  });
});
