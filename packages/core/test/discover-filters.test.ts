import { describe, expect, test } from "vitest";

import { DiscoverInput } from "@sofa/api/schemas";

import { getDiscoverParams } from "../src/discovery";

describe("Discover compound filters", () => {
  test("combines the Korean free-discovery acceptance case with genre, year and provider", () => {
    const input = DiscoverInput.parse({
      type: "movie",
      originCountry: "KR",
      language: "ko",
      ratingMin: 7,
      runtimeMax: 120,
      accessType: "free_or_ads",
      genreId: 18,
      yearMin: 2000,
      yearMax: 2025,
      platformId: "provider",
    });

    expect(getDiscoverParams(input, [515, 615], "GB")).toEqual({
      sort_by: "popularity.desc",
      "vote_count.gte": "50",
      with_origin_country: "KR",
      with_original_language: "ko",
      "vote_average.gte": "7",
      "with_runtime.lte": "120",
      with_watch_monetization_types: "free|ads",
      watch_region: "US",
      with_genres: "18",
      "primary_release_date.gte": "2000-01-01",
      "primary_release_date.lte": "2025-12-31",
      with_watch_providers: "515|615",
    });
  });

  test.each(["free", "ads"] as const)(
    "keeps %s availability US-scoped without a provider",
    (accessType) => {
      const params = getDiscoverParams(
        DiscoverInput.parse({ type: "movie", accessType }),
        [],
        "GB",
      );
      expect(params.with_watch_monetization_types).toBe(accessType);
      expect(params.watch_region).toBe("US");
      expect(params.with_watch_providers).toBeUndefined();
    },
  );

  test("preserves the existing regional provider filter when free access is not selected", () => {
    const params = getDiscoverParams(
      DiscoverInput.parse({ type: "movie", platformId: "provider" }),
      [8],
      "GB",
    );
    expect(params.watch_region).toBe("GB");
    expect(params.with_watch_monetization_types).toBeUndefined();
  });

  test.each([
    { originCountry: "kr" },
    { language: "KR" },
    { runtimeMax: 0 },
    { runtimeMax: 120.5 },
    { accessType: "flatrate" },
  ])("rejects invalid new filter values: %o", (filters) => {
    expect(DiscoverInput.safeParse({ type: "movie", ...filters }).success).toBe(false);
  });
});

describe("US movie content ratings", () => {
  test("combines an inclusive maximum certification with the existing compound filters", () => {
    const params = getDiscoverParams(
      DiscoverInput.parse({
        type: "movie",
        certification: "PG-13",
        originCountry: "KR",
        language: "ko",
        ratingMin: 7,
        accessType: "free_or_ads",
      }),
    );
    expect(params).toMatchObject({
      "certification.gte": "G",
      "certification.lte": "PG-13",
      certification_country: "US",
      region: "US",
      with_origin_country: "KR",
      with_original_language: "ko",
      "vote_average.gte": "7",
      with_watch_monetization_types: "free|ads",
      watch_region: "US",
    });
    expect(params["with_runtime.lte"]).toBeUndefined();
    expect(params.certification).toBeUndefined();
  });

  test("does not send movie certifications to TV discovery", () => {
    const params = getDiscoverParams(DiscoverInput.parse({ type: "tv", certification: "R" }));
    expect(params.certification).toBeUndefined();
    expect(params["certification.gte"]).toBeUndefined();
    expect(params["certification.lte"]).toBeUndefined();
    expect(params.certification_country).toBeUndefined();
    expect(params.region).toBeUndefined();
  });

  test("rejects unsupported certifications", () => {
    expect(DiscoverInput.safeParse({ type: "movie", certification: "TV-MA" }).success).toBe(false);
  });
});

test.each(["G", "PG", "PG-13", "R", "NC-17"] as const)(
  "treats %s as the inclusive ceiling without including unrated titles",
  (certification) => {
    const params = getDiscoverParams(DiscoverInput.parse({ type: "movie", certification }));
    expect(params["certification.gte"]).toBe("G");
    expect(params["certification.lte"]).toBe(certification);
    expect(params.certification).toBeUndefined();
  },
);

test("any content rating leaves certification bounds unset", () => {
  const params = getDiscoverParams(DiscoverInput.parse({ type: "movie" }));
  expect(params["certification.gte"]).toBeUndefined();
  expect(params["certification.lte"]).toBeUndefined();
});
