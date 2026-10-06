import { beforeEach, expect, test, vi } from "vitest";

import {
  listCreatorMoviePicks,
  listRecommendationCreators,
} from "@sofa/db/queries/creator-recommendations";
import { importVerifiedCreatorPicks } from "@sofa/db/queries/creator-recommendations";
import { clearAllTables } from "@sofa/test/db";

import { extractExplicitPicks } from "../src/creator-pick-extraction";
import { seedCreatorCatalog } from "./fixtures/creator-catalog";
vi.mock("@sofa/logger", () => ({
  createLogger: () => ({
    error: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    debug: vi.fn<() => void>(),
  }),
}));
beforeEach(() => {
  clearAllTables();
  seedCreatorCatalog();
});
test("requires an explicit positive endorsement and exact title/year syntax", () => {
  expect(extractExplicitPicks('I recommend "Challengers" (2024).')).toEqual([
    { title: "Challengers", year: 2024, startSeconds: null },
  ]);
  for (const text of [
    'I do not recommend "Challengers" (2024)',
    'They say I recommend "Challengers" (2024)',
    'Review: "Challengers" (2024)',
    'I recommend "Challengers"',
    'You should not watch "Challengers" (2024)',
  ])
    expect(extractExplicitPicks(text)).toEqual([]);
});
test("imports atomically and idempotently without replacing curated picks", () => {
  const creator = listRecommendationCreators()[0];
  const video = {
    videoId: "abcdefghijk",
    videoTitle: "Recommendations",
    publishedAt: "2026-10-06T00:00:00Z",
  };
  const picks = [{ tmdbId: 937287, movieTitle: "Challengers", startSeconds: null }];
  expect(importVerifiedCreatorPicks(creator.id, video, picks)).toBe(1);
  expect(importVerifiedCreatorPicks(creator.id, video, picks)).toBe(0);
  expect(listCreatorMoviePicks()).toHaveLength(12);
});
