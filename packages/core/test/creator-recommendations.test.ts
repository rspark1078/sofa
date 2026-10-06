import { beforeEach, expect, test, vi } from "vitest";

import { clearAllTables, insertStatus, insertTitle, insertUser } from "@sofa/test/db";

const { getMovieDetails } = vi.hoisted(() => ({
  getMovieDetails: vi.fn<typeof import("@sofa/tmdb/client").getMovieDetails>(),
}));
vi.mock("@sofa/tmdb/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sofa/tmdb/client")>()),
  getMovieDetails,
}));
import {
  listCreatorMoviePicks,
  listRecommendationCreators,
} from "@sofa/db/queries/creator-recommendations";

import {
  clearCreatorMovieCache,
  getCreatorCredits,
  getCreatorPickIds,
  getRecommendationCandidates,
  mergeRecommendationCandidates,
} from "../src/creator-recommendations";
import { updateCriticPreferences } from "../src/settings";
import { seedCreatorCatalog } from "./fixtures/creator-catalog";

function movieDetails(id: number) {
  return {
    id,
    title: "Movie " + id,
    adult: false,
    budget: 0,
    popularity: 1,
    revenue: 0,
    runtime: 100,
    video: false,
    vote_count: 1,
    vote_average: 7,
    release_date: "2024-01-01",
    poster_path: "/poster.jpg",
  };
}

beforeEach(() => {
  clearAllTables();
  seedCreatorCatalog();
  clearCreatorMovieCache();
  getMovieDetails.mockReset();
  getMovieDetails.mockImplementation(async (id: number) => movieDetails(id));
});

test("catalog credits have verified channel identities, exact videos, dates and evidence", () => {
  expect(listRecommendationCreators()).toHaveLength(3);
  expect(listCreatorMoviePicks()).toHaveLength(11);
  for (const pick of listCreatorMoviePicks()) {
    const credit = getCreatorCredits(pick.tmdbId, "movie").find(
      (entry) => entry.id === pick.creatorSlug,
    )!;
    expect(credit).toBeDefined();
    expect(credit.channelUrl).toMatch(/^https:\/\/www\.youtube\.com\/channel\/UC/);
    const url = new URL(credit.videoUrl);
    expect(url.origin).toBe("https://www.youtube.com");
    expect(url.pathname).toBe("/watch");
    expect(url.searchParams.get("v")).toMatch(/^[\w-]{11}$/);
    expect(pick.evidenceUrl.startsWith("https://")).toBe(true);
    expect(credit.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  expect(getCreatorCredits(799379, "movie")[0].videoUrl).toContain("t=374s");
  expect(getCreatorCredits(960704, "movie")).toEqual([]);
  expect(getCreatorCredits(431, "tv")).toEqual([]);
});

test("source filtering interleaves creators fairly and personal never imports creator movies", async () => {
  expect(getCreatorPickIds().slice(0, 3)).toEqual([603692, 1019939, 431]);
  expect(getCreatorPickIds("jeremy-jahns")).toEqual([603692, 940721, 872585]);
  expect(getCreatorPickIds("personal")).toEqual([]);
  insertUser();
  expect(await getRecommendationCandidates("user-1", "personal")).toEqual([]);
  expect(getMovieDetails).not.toHaveBeenCalled();
});

test("creators produce cold-start recommendations while excluding only this user's tracked movies", async () => {
  insertUser();
  insertUser("other");
  const tracked = insertTitle({ id: "tracked", tmdbId: 603692 });
  insertStatus("user-1", tracked, "watchlist");
  const result = await getRecommendationCandidates("user-1", "jeremy-jahns");
  expect(result.map((movie) => movie.tmdbId)).toEqual([940721, 872585]);
  expect(
    (await getRecommendationCandidates("other", "jeremy-jahns")).map((movie) => movie.tmdbId),
  ).toEqual([603692, 940721, 872585]);
  expect(getMovieDetails).toHaveBeenCalledTimes(3);
});

test("metadata requests are cached, coalesced and refreshed after one hour", async () => {
  insertUser();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    await Promise.all([
      getRecommendationCandidates("user-1", "jeremy-jahns"),
      getRecommendationCandidates("user-1", "jeremy-jahns"),
    ]);
    expect(getMovieDetails).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(1000 + 60 * 60 * 1000);
    await getRecommendationCandidates("user-1", "jeremy-jahns");
    expect(getMovieDetails).toHaveBeenCalledTimes(6);
  } finally {
    clock.mockRestore();
  }
});

test("failed or mismatched metadata never gets cached or credited to another movie", async () => {
  insertUser();
  getMovieDetails.mockImplementation(async (id: number) => movieDetails(id === 603692 ? 999 : id));
  await expect(getRecommendationCandidates("user-1", "jeremy-jahns")).rejects.toThrow(
    "identity mismatch",
  );
  getMovieDetails.mockImplementation(async (id: number) => movieDetails(id));
  expect(await getRecommendationCandidates("user-1", "jeremy-jahns")).toHaveLength(3);
});

test("blending deduplicates same movie but preserves a TV title with the same numeric ID", () => {
  const personal = [
    { tmdbId: 1, type: "movie" },
    { tmdbId: 2, type: "movie" },
  ];
  const creators = [
    { tmdbId: 1, type: "movie" },
    { tmdbId: 1, type: "tv" },
    { tmdbId: 3, type: "movie" },
  ];
  expect(mergeRecommendationCandidates(personal, creators)).toEqual([
    personal[0],
    personal[1],
    creators[1],
    creators[2],
  ]);
});

test("saved selections constrain combined and individual sources per account", async () => {
  insertUser("user-1");
  insertUser("user-2");
  updateCriticPreferences("user-1", { creatorIds: ["jeremy-jahns"], refreshFrequency: "daily" });
  expect((await getRecommendationCandidates("user-1")).map((movie) => movie.tmdbId)).toEqual([
    603692, 940721, 872585,
  ]);
  expect(await getRecommendationCandidates("user-1", "chris-stuckmann")).toEqual([]);
  expect(await getRecommendationCandidates("user-2", "chris-stuckmann")).toHaveLength(4);
  updateCriticPreferences("user-1", { creatorIds: [], refreshFrequency: "manual" });
  expect(getCreatorPickIds("all", [])).toEqual([]);
  expect(await getRecommendationCandidates("user-1")).toEqual([]);
});
