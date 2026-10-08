import { beforeEach, describe, expect, test, vi } from "vitest";

import type { TmdbWatchProviderResponse } from "@sofa/tmdb/client";

const { getWatchProviders } = vi.hoisted(() => ({
  getWatchProviders: vi.fn<() => Promise<TmdbWatchProviderResponse>>(),
}));
vi.mock("@sofa/tmdb/client", () => ({ getWatchProviders }));
import {
  clearVerifiedAvailabilityCache,
  getVerifiedUsAvailability,
  matchingUsOffers,
  verifyUsCandidates,
  verifyRecommendationCandidates,
} from "../src/verified-availability";

beforeEach(() => {
  clearVerifiedAvailabilityCache();
  getWatchProviders.mockReset();
});

function availability(): TmdbWatchProviderResponse {
  return {
    id: 1,
    results: {
      US: {
        link: "https://www.themoviedb.org/movie/1/watch?locale=US",
        ads: [
          { display_priority: 1, provider_id: 73, provider_name: "Tubi", logo_path: "/logo.png" },
        ],
        rent: [
          {
            display_priority: 2,
            provider_id: 575,
            provider_name: "OnDemandKorea",
            logo_path: "/logo.png",
          },
        ],
      },
      KR: {
        free: [
          {
            display_priority: 2,
            provider_id: 575,
            provider_name: "OnDemandKorea",
            logo_path: "/logo.png",
          },
        ],
      },
    },
  };
}

describe("verified US availability", () => {
  test("does not combine a free offer from one provider with rental availability on another", async () => {
    getWatchProviders.mockResolvedValue(availability());
    const result = await getVerifiedUsAvailability(1, "movie");
    expect(matchingUsOffers(result.offers, "free_or_ads", [575])).toEqual([]);
    expect(matchingUsOffers(result.offers, "free_or_ads", [73])).toHaveLength(1);
    expect(matchingUsOffers(result.offers, "paid", [575])).toHaveLength(1);
    expect(matchingUsOffers(result.offers, "free", [575])).toEqual([]);
    expect(result.watchPageUrl).toContain("locale=US");
  });

  test("coalesces requests, reuses successful results and expires them after 15 minutes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      getWatchProviders.mockResolvedValue(availability());
      await Promise.all([
        getVerifiedUsAvailability(1, "movie"),
        getVerifiedUsAvailability(1, "movie"),
      ]);
      await getVerifiedUsAvailability(1, "movie");
      expect(getWatchProviders).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(1000 + 15 * 60 * 1000);
      await getVerifiedUsAvailability(1, "movie");
      expect(getWatchProviders).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  test("does not cache failures or falsely report verified empty results", async () => {
    getWatchProviders.mockRejectedValueOnce(new Error("upstream offline"));
    await expect(verifyUsCandidates([{ tmdbId: 1, type: "movie" }], "free_or_ads")).rejects.toThrow(
      "upstream offline",
    );
    getWatchProviders.mockResolvedValue(availability());
    expect(await verifyUsCandidates([{ tmdbId: 1, type: "movie" }], "free_or_ads")).toHaveLength(1);
  });

  test("preserves order and excludes unavailable, foreign-only and wrong-provider offers", async () => {
    getWatchProviders.mockResolvedValue(availability());
    expect(await verifyUsCandidates([{ tmdbId: 1, type: "movie" }], "free_or_ads", [575])).toEqual(
      [],
    );
    expect(await verifyUsCandidates([{ tmdbId: 1, type: "movie" }], "free_or_ads", [])).toEqual([]);
    const result = await verifyUsCandidates(
      [
        { tmdbId: 2, type: "movie" },
        { tmdbId: 1, type: "movie" },
      ],
      "free_or_ads",
      [73],
    );
    expect(result.map((item) => item.tmdbId)).toEqual([2, 1]);
    expect(result[0].usAvailability.offers[0].offerType).toBe("ads");
  });
});

test("Free recommendations include ad-supported offers", async () => {
  getWatchProviders.mockResolvedValue(availability());
  const items = await verifyRecommendationCandidates([{ tmdbId: 1, type: "movie" }], "free");
  expect(items).toHaveLength(1);
  expect(items[0].usAvailability.offers.map((offer) => offer.offerType)).toEqual(["ads"]);
});

test("recommendation verification retains the entire candidate pool", async () => {
  getWatchProviders.mockResolvedValue(availability());
  const candidates = Array.from({ length: 50 }, (_, index) => ({
    tmdbId: index + 10,
    type: "movie" as const,
  }));
  expect(await verifyRecommendationCandidates(candidates)).toHaveLength(50);
  expect(getWatchProviders).toHaveBeenCalledTimes(50);
});
