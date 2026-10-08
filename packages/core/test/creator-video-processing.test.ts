import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { beginCreatorChannelCheck } from "@sofa/db/queries/creator-checks";
import {
  listCreatorMoviePicks,
  listRecommendationCreators,
} from "@sofa/db/queries/creator-recommendations";
import { creatorVideoChecks, creatorMovieObservations } from "@sofa/db/schema";
import { clearAllTables, testDb } from "@sofa/test/db";

import { getVideoPickCheck, processCreatorVideo } from "../src/creator-pick-extraction";
import { CreatorModelError } from "../src/creator-pick-model";
import { getSetting } from "../src/settings";
import { seedCreatorCatalog } from "./fixtures/creator-catalog";
const mocks = vi.hoisted(() => ({
  search: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  details: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  model: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@sofa/tmdb/client", () => ({
  searchMovies: mocks.search,
  getMovieDetails: mocks.details,
}));
vi.mock("../src/creator-pick-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/creator-pick-model")>()),
  analyzeModelMovies: mocks.model,
}));
vi.mock("@sofa/logger", () => ({
  createLogger: () => ({
    error: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    debug: vi.fn<() => void>(),
  }),
}));
const video = {
  videoId: "abcdefghijk",
  videoTitle: "Recommendations",
  publishedAt: "2026-10-06T00:00:00Z",
};
beforeEach(() => {
  clearAllTables();
  seedCreatorCatalog();
  vi.resetAllMocks();
  vi.stubEnv("CREATOR_CAPTION_TOOL", "");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          "var ytInitialPlayerResponse = " +
            JSON.stringify({
              videoDetails: {
                videoId: video.videoId,
                channelId: "channel",
                shortDescription: "I recommend Challengers.",
              },
            }) +
            ";</script>",
        ),
    ),
  );
  mocks.model.mockResolvedValue([
    {
      title: "Challengers",
      year: 2024,
      assessment: "recommended",
      evidence: "I recommend Challengers.",
      startSeconds: null,
    },
  ]);
  mocks.search.mockResolvedValue({
    total_pages: 1,
    results: [{ id: 937287, title: "Challengers", release_date: "2024-04-18" }],
  });
  mocks.details.mockResolvedValue({ id: 937287, title: "Challengers", release_date: "2024-04-18" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
test("saves only verified movie identities with automated provenance and no duplicate processing", async () => {
  const creator = listRecommendationCreators()[0];
  expect(await processCreatorVideo(creator.id, "channel", video)).toMatchObject({
    state: "added",
    picksAdded: 1,
  });
  const pick = listCreatorMoviePicks().find((p) => p.tmdbId === 937287)!;
  expect(JSON.parse(getSetting(`creator-pick:${pick.id}:provenance`)!)).toMatchObject({
    method: "automated",
    evidence: "I recommend Challengers.",
  });
  expect(await processCreatorVideo(creator.id, "channel", video)).toMatchObject({ picksAdded: 0 });
  expect(mocks.search).toHaveBeenCalledTimes(1);
});
test("holds ambiguous paginated searches for review without saving picks", async () => {
  mocks.search.mockResolvedValue({
    total_pages: 2,
    results: [{ id: 937287, title: "Challengers", release_date: "2024-04-18" }],
  });
  expect(
    await processCreatorVideo(listRecommendationCreators()[0].id, "channel", video),
  ).toMatchObject({ state: "review", picksAdded: 0 });
  expect(listCreatorMoviePicks()).toHaveLength(11);
});
test("model failures preserve curated picks and allow retry", async () => {
  mocks.model.mockRejectedValueOnce(new CreatorModelError("model_unavailable"));
  const creator = listRecommendationCreators()[0];
  expect(await processCreatorVideo(creator.id, "channel", video)).toMatchObject({
    state: "failed",
    picksAdded: 0,
  });
  expect(listCreatorMoviePicks()).toHaveLength(11);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600_001);
  expect(await processCreatorVideo(creator.id, "channel", video)).toMatchObject({
    state: "added",
    picksAdded: 1,
  });
  clock.mockRestore();
});

test("coalesced processing reports one actual attempt and does not double-count picks", async () => {
  const creator = listRecommendationCreators()[0];
  const results = await Promise.all([
    processCreatorVideo(creator.id, "channel", video),
    processCreatorVideo(creator.id, "channel", video),
  ]);
  expect(results.map((result) => result.attempted)).toEqual([true, false]);
  expect(results.reduce((count, result) => count + result.picksAdded, 0)).toBe(1);
  expect(mocks.model).toHaveBeenCalledTimes(1);
  expect((await processCreatorVideo(creator.id, "channel", video)).attempted).toBe(false);
});

test("processed movie observations trace through their video to a channel audit", async () => {
  const creator = listRecommendationCreators()[0];
  const channelCheckId = beginCreatorChannelCheck({ creatorId: creator.id, trigger: "manual" });
  await processCreatorVideo(creator.id, "channel", video, channelCheckId);
  const check = testDb.select().from(creatorVideoChecks).get()!;
  expect(check.channelCheckId).toBe(channelCheckId);
  expect(testDb.select().from(creatorMovieObservations).get()?.videoCheckId).toBe(check.id);
});

test("coverage reports the full text when explicit rules replace the bounded model", async () => {
  const description = 'I recommend "Challengers" (2024). ' + "Context. ".repeat(4000);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        "var ytInitialPlayerResponse = " +
          JSON.stringify({
            videoDetails: {
              videoId: video.videoId,
              channelId: "channel",
              shortDescription: description,
            },
          }) +
          ";</script>",
      ),
    ),
  );
  mocks.model.mockResolvedValueOnce(null);
  const creator = listRecommendationCreators()[0];
  await processCreatorVideo(creator.id, "channel", video);
  expect(getVideoPickCheck(creator.id, video.videoId)).toMatchObject({
    sourceCharacters: description.length,
    analyzedCharacters: description.length,
  });
});
