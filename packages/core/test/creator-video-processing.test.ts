import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  listCreatorMoviePicks,
  listRecommendationCreators,
} from "@sofa/db/queries/creator-recommendations";
import { clearAllTables } from "@sofa/test/db";

import { processCreatorVideo } from "../src/creator-pick-extraction";
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
vi.mock("../src/creator-pick-model", () => ({ extractModelPicks: mocks.model }));
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
    { title: "Challengers", year: 2024, evidence: "I recommend Challengers.", startSeconds: null },
  ]);
  mocks.search.mockResolvedValue({
    total_pages: 1,
    results: [{ id: 937287, title: "Challengers", release_date: "2024-04-18" }],
  });
  mocks.details.mockResolvedValue({ id: 937287, title: "Challengers", release_date: "2024-04-18" });
});
afterEach(() => vi.unstubAllGlobals());
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
  mocks.model.mockRejectedValueOnce(new Error("offline"));
  const creator = listRecommendationCreators()[0];
  expect(await processCreatorVideo(creator.id, "channel", video)).toMatchObject({
    state: "failed",
    picksAdded: 0,
  });
  expect(listCreatorMoviePicks()).toHaveLength(11);
  expect(await processCreatorVideo(creator.id, "channel", video)).toMatchObject({
    state: "added",
    picksAdded: 1,
  });
});
