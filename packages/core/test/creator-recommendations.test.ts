import { beforeEach, expect, test, vi } from "vitest";

import {
  clearAllTables,
  insertRecommendation,
  insertStatus,
  insertTitle,
  insertUser,
} from "@sofa/test/db";

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
  clearRecommendationPageSessions,
  getCreatorCredits,
  getCreatorPickIds,
  getRecommendationCandidates,
  getRecommendationCandidatePage,
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
  clearRecommendationPageSessions();
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

test("combined recommendations retain every distinct candidate beyond the old cap", () => {
  const personal = Array.from({ length: 60 }, (_, index) => ({ tmdbId: index + 1, type: "movie" }));
  const creators = Array.from({ length: 60 }, (_, index) => ({
    tmdbId: index + 31,
    type: "movie",
  }));
  const combined = mergeRecommendationCandidates(personal, creators);
  expect(combined).toHaveLength(90);
  expect(new Set(combined.map((item) => item.tmdbId))).toEqual(
    new Set([...personal, ...creators].map((item) => item.tmdbId)),
  );
});

test("pages hydrate only their batch and preserve every distinct recommendation", async () => {
  insertUser();
  const first = await getRecommendationCandidatePage("user-1", "all", null, 2);
  expect(first.candidates).toHaveLength(2);
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(getMovieDetails).toHaveBeenCalledTimes(2);
  const collected = [...first.candidates];
  let cursor = first.nextCursor;
  while (cursor !== null) {
    const page = await getRecommendationCandidatePage("user-1", "all", cursor, 2);
    collected.push(...page.candidates);
    cursor = page.nextCursor;
  }
  expect(collected.map((movie) => movie.tmdbId)).toEqual(
    (await getRecommendationCandidates("user-1")).map((movie) => movie.tmdbId),
  );
  expect(new Set(collected.map((movie) => movie.tmdbId)).size).toBe(collected.length);
});
test("tracked-only pages still advance the cursor to later recommendations", async () => {
  insertUser();
  const ids = getCreatorPickIds();
  insertStatus("user-1", insertTitle({ id: "tracked", tmdbId: ids[0] }), "watchlist");
  const first = await getRecommendationCandidatePage("user-1", "all", null, 1);
  expect(first.candidates).toEqual([]);
  expect(first.nextCursor).toEqual(expect.any(String));
  const next = await getRecommendationCandidatePage("user-1", "all", first.nextCursor!, 1);
  expect(next.candidates[0].tmdbId).toBe(ids[1]);
});

test("all critics combines only selected critics and respects selecting none", async () => {
  insertUser();
  updateCriticPreferences("user-1", {
    creatorIds: ["jeremy-jahns", "chris-stuckmann"],
    refreshFrequency: "daily",
  });
  const expected = getCreatorPickIds("all", ["jeremy-jahns", "chris-stuckmann"]);
  expect(getCreatorPickIds("critics", ["jeremy-jahns", "chris-stuckmann"])).toEqual(expected);
  expect(
    (await getRecommendationCandidates("user-1", "critics")).map((movie) => movie.tmdbId),
  ).toEqual(expected);
  updateCriticPreferences("user-1", { creatorIds: [], refreshFrequency: "manual" });
  expect(await getRecommendationCandidates("user-1", "critics")).toEqual([]);
});

test("all critics excludes personal-only recommendations while all sources includes them", async () => {
  insertUser();
  insertTitle({ id: "history-source", tmdbId: 900001 });
  insertTitle({ id: "personal-only", tmdbId: 900002 });
  insertStatus("user-1", "history-source", "completed");
  insertRecommendation("history-source", "personal-only", { rank: 1 });
  const critics = await getRecommendationCandidates("user-1", "critics");
  expect(critics.some((title) => title.tmdbId === 900002)).toBe(false);
  const combined = await getRecommendationCandidates("user-1", "all");
  expect(combined.some((title) => title.tmdbId === 900002)).toBe(true);
  expect(combined).toHaveLength(critics.length + 1);
});

function personalPool() {
  insertUser();
  insertTitle({ id: "page-source", tmdbId: 999000 });
  insertStatus("user-1", "page-source", "completed");
  for (let i = 1; i <= 5; i++) {
    insertTitle({ id: `page-${i}`, tmdbId: 999000 + i });
    insertRecommendation("page-source", `page-${i}`, { rank: i });
  }
}

test("tracking an earlier personal candidate cannot skip the next unseen title", async () => {
  personalPool();
  const first = await getRecommendationCandidatePage("user-1", "personal", null, 2);
  expect(first.candidates.map((title) => title.id)).toEqual(["page-1", "page-2"]);
  insertStatus("user-1", "page-1", "watchlist");
  const second = await getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2);
  expect(second.candidates.map((title) => title.id)).toEqual(["page-3", "page-4"]);
  const third = await getRecommendationCandidatePage("user-1", "personal", second.nextCursor, 2);
  expect(third.candidates.map((title) => title.id)).toEqual(["page-5"]);
  expect(third.nextCursor).toBeNull();
  expect(getMovieDetails).not.toHaveBeenCalled();
});

test("new recommendations enter a fresh session without reordering an active one", async () => {
  personalPool();
  const first = await getRecommendationCandidatePage("user-1", "personal", null, 2);
  insertTitle({ id: "new-first", tmdbId: 999099 });
  insertRecommendation("page-source", "new-first", { rank: 0 });
  const second = await getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2);
  expect(second.candidates.map((title) => title.id)).toEqual(["page-3", "page-4"]);
  const refreshed = await getRecommendationCandidatePage("user-1", "personal", null, 2);
  expect(refreshed.candidates[0].id).toBe("new-first");
});

test("newly tracked future candidates are hidden without losing subsequent pages", async () => {
  personalPool();
  const first = await getRecommendationCandidatePage("user-1", "personal", null, 2);
  insertStatus("user-1", "page-3", "watchlist");
  insertStatus("user-1", "page-4", "completed");
  const second = await getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2);
  expect(second.candidates).toEqual([]);
  const third = await getRecommendationCandidatePage("user-1", "personal", second.nextCursor, 2);
  expect(third.candidates.map((title) => title.id)).toEqual(["page-5"]);
});

test("cursors reject another account, source, availability filter or changed critic selection", async () => {
  personalPool();
  insertUser("other");
  const first = await getRecommendationCandidatePage("user-1", "personal", null, 2, "free");
  const expected = { code: "CONFLICT", data: { code: "RECOMMENDATION_SESSION_EXPIRED" } };
  await expect(
    getRecommendationCandidatePage("other", "personal", first.nextCursor, 2, "free"),
  ).rejects.toMatchObject(expected);
  await expect(
    getRecommendationCandidatePage("user-1", "all", first.nextCursor, 2, "free"),
  ).rejects.toMatchObject(expected);
  await expect(
    getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2, "paid"),
  ).rejects.toMatchObject(expected);
  updateCriticPreferences("user-1", { creatorIds: [], refreshFrequency: "manual" });
  await expect(
    getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2, "free"),
  ).rejects.toMatchObject(expected);
});

test("expired or lost sessions return a recoverable error and a fresh first page works", async () => {
  personalPool();
  const clock = vi.spyOn(Date, "now");
  try {
    const first = await getRecommendationCandidatePage("user-1", "personal", null, 2);
    clock.mockReturnValue(Date.now() + 3600_001);
    await expect(
      getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2),
    ).rejects.toMatchObject({ data: { code: "RECOMMENDATION_SESSION_EXPIRED" } });
    const fresh = await getRecommendationCandidatePage("user-1", "personal", null, 2);
    expect(fresh.candidates).toHaveLength(2);
    clearRecommendationPageSessions();
    await expect(
      getRecommendationCandidatePage("user-1", "personal", fresh.nextCursor, 2),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    clock.mockRestore();
  }
});

test("retrying the same page is deterministic and per-account eviction is recoverable", async () => {
  personalPool();
  const first = await getRecommendationCandidatePage("user-1", "personal", null, 2);
  const page = await getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2);
  expect(await getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2)).toEqual(
    page,
  );
  for (let i = 0; i < 4; i++) await getRecommendationCandidatePage("user-1", "personal", null, 2);
  await expect(
    getRecommendationCandidatePage("user-1", "personal", first.nextCursor, 2),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
