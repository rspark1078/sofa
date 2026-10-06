import { describe, expect, test } from "vitest";

import { discoverSearchSchema } from "./discover-search";

describe("Discover URL filters", () => {
  test("restores the compound acceptance filters and sort from a shared URL", () => {
    const filters = {
      type: "movie",
      originCountry: "KR",
      language: "ko",
      ratingMin: 7,
      certification: "PG-13",
      accessType: "free_or_ads",
      genreId: 18,
      yearMin: 2000,
      yearMax: 2025,
      platformId: "provider",
      sortBy: "vote_average.desc",
    };
    expect(discoverSearchSchema.parse(filters)).toEqual(filters);
  });

  test("ignores invalid URL values while preserving valid filters", () => {
    const filters = discoverSearchSchema.parse({
      certification: "invalid",
      accessType: "invalid",
      language: "ko",
      originCountry: "kr",
    });
    expect(filters.certification).toBeUndefined();
    expect(filters.accessType).toBeUndefined();
    expect(filters.originCountry).toBeUndefined();
    expect(filters.language).toBe("ko");
  });

  test("old free-only and ad-supported URLs use the combined Free Providers filter", () => {
    for (const accessType of ["free", "ads", "free_or_ads"]) {
      expect(discoverSearchSchema.parse({ accessType }).accessType).toBe("free_or_ads");
    }
    expect(discoverSearchSchema.parse({ accessType: "paid" }).accessType).toBe("paid");
  });

  test("empty search restores defaults and ignores pagination", () => {
    expect(discoverSearchSchema.parse({})).toEqual({});
    expect(discoverSearchSchema.parse({ page: 5, runtimeMax: 120 })).toEqual({});
  });
});

test("preserves multiple providers in bookmarked URLs", () => {
  expect(
    discoverSearchSchema.parse({ platformIds: ["tubi", "odk"], accessType: "free_or_ads" }),
  ).toEqual({ platformIds: ["tubi", "odk"], accessType: "free_or_ads" });
  expect(discoverSearchSchema.parse({ platformId: "legacy-provider" }).platformId).toBe(
    "legacy-provider",
  );
  expect(discoverSearchSchema.parse({ platformIds: "invalid" }).platformIds).toBeUndefined();
});
