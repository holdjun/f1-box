import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

interface CurrentSeason {
  events: Array<{ round: number; slug: string }>;
}

const currentSeason = JSON.parse(
  readFileSync(
    new URL(
      "../../../../.superpowers/designs/night-grid/season-2026-current.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as CurrentSeason;

test("@desktop home presents the current season at a glance", async ({ page }) => {
  const browserRequests: string[] = [];
  page.on("request", (request) => browserRequests.push(request.url()));

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Hungarian Grand Prix",
  );
  await expect(page.getByText("2026 SEASON / ROUND 11")).toBeVisible();
  await expect(page.getByRole("link", { name: "View race" })).toHaveAttribute(
    "href",
    "/seasons/2026/races/11-hungarian-grand-prix",
  );
  await expect(page.getByRole("region", { name: "2026 calendar" })).toBeVisible();
  await expect(page.getByText("LATEST ROUND", { exact: true })).toBeVisible();
  await expect(page.getByText("Andrea Kimi Antonelli", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("204", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Mercedes", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("358", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Jolpica F1 API", { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/Fetched 21 Jul 2026, 04:40 UTC/)).toBeVisible();
  expect(browserRequests.some((url) => /jolpi|ergast/i.test(url))).toBe(false);
});

test("@desktop season route exposes every round and full standings", async ({
  page,
}) => {
  await page.goto("/seasons/2026");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2026 Season");
  const raceLinks = page.locator(
    'main a[href^="/seasons/2026/races/"]',
  );
  await expect(raceLinks).toHaveCount(22);

  const actualHrefs = await raceLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  const expectedHrefs = currentSeason.events.map(
    (event) => `/seasons/2026/races/${event.round}-${event.slug}`,
  );
  expect(actualHrefs).toEqual(expectedHrefs);

  const driverTable = page.getByRole("table", { name: "Driver standings" });
  const constructorTable = page.getByRole("table", {
    name: "Constructor standings",
  });
  await expect(driverTable.getByRole("row")).toHaveCount(23);
  await expect(constructorTable.getByRole("row")).toHaveCount(12);
  await expect(driverTable.getByRole("rowheader", { name: /Andrea Kimi Antonelli/ })).toBeVisible();
  await expect(constructorTable.getByRole("rowheader", { name: "Mercedes" })).toBeVisible();
});

test("@desktop completed race shows qualifying and race classification", async ({
  page,
}) => {
  await page.goto("/seasons/2026/races/10-belgian-grand-prix");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Belgian Grand Prix",
  );
  await expect(page.getByText("COMPLETE", { exact: true }).first()).toBeVisible();

  const qualifying = page.getByRole("table", {
    name: "Qualifying classification",
  });
  const race = page.getByRole("table", { name: "Race classification" });
  await expect(qualifying.getByRole("row")).toHaveCount(23);
  await expect(race.getByRole("row")).toHaveCount(23);
  await expect(qualifying.getByRole("cell", { name: "1:44.361" })).toBeVisible();
  await expect(race.getByRole("cell", { name: "1:24:42.479" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Previous · British Grand Prix/ })).toHaveAttribute(
    "href",
    "/seasons/2026/races/9-british-grand-prix",
  );
  await expect(page.getByRole("link", { name: /Next · Hungarian Grand Prix/ })).toHaveAttribute(
    "href",
    "/seasons/2026/races/11-hungarian-grand-prix",
  );
});

test("@desktop future race keeps schedule useful without invented results", async ({
  page,
}) => {
  await page.goto("/seasons/2026/races/11-hungarian-grand-prix");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Hungarian Grand Prix",
  );
  await expect(page.getByRole("heading", { name: "Weekend schedule" })).toBeVisible();
  await expect(page.getByText("25 Jul 2026, 14:00 UTC")).toBeVisible();
  await expect(page.getByText("Qualifying results are not available yet.")).toBeVisible();
  await expect(page.getByText("Race results are not available yet.")).toBeVisible();
});

test("@desktop unknown season and race routes return the editorial 404", async ({
  page,
}) => {
  for (const path of [
    "/seasons/2025",
    "/seasons/2026/races/99-lap-not-found",
    "/not-on-the-calendar",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Lap not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
  }
});

test("@mobile 375px layout has no page overflow and keeps the calendar rail scrollable", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const hasPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasPageOverflow).toBe(false);

  const rail = page.getByRole("region", { name: "2026 calendar" });
  await expect(rail).toBeVisible();
  expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  const viewRace = page.getByRole("link", { name: "View race" });
  expect((await viewRace.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await page.goto("/seasons/2026/races/10-belgian-grand-prix");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await expect(page.getByRole("table", { name: "Race classification" })).toBeVisible();
});

test("@reduced reduced motion leaves key content immediately visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const hero = page.getByRole("heading", { level: 1 });
  await expect(hero).toBeVisible();
  await expect(page.getByRole("region", { name: "2026 calendar" })).toBeVisible();
  await expect(hero).toHaveCSS("animation-name", "none");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
});
