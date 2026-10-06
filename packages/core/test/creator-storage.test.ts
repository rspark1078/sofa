import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";

import {
  listCreatorMoviePicks,
  listRecommendationCreators,
} from "@sofa/db/queries/creator-recommendations";
import { creatorPicks, creatorVideos, recommendationCreators } from "@sofa/db/schema";
import {
  applyMigrations,
  clearAllTables,
  insertStatus,
  insertTitle,
  insertUser,
  testClient,
  testDb,
} from "@sofa/test/db";

import {
  getCreatorCredits,
  getCreatorPickIds,
  getRecommendationCreators,
} from "../src/creator-recommendations";
import { creatorMigrationSql, seedCreatorCatalog } from "./fixtures/creator-catalog";

beforeEach(() => {
  clearAllTables();
  seedCreatorCatalog();
});

test("migration creates a complete catalog in a fresh database with valid relationships", () => {
  const fresh = new Database(":memory:");
  try {
    fresh.pragma("foreign_keys = ON");
    fresh.exec(creatorMigrationSql);
    expect(fresh.prepare("SELECT count(*) AS n FROM recommendationCreators").get()).toEqual({
      n: 3,
    });
    expect(fresh.prepare("SELECT count(*) AS n FROM creatorVideos").get()).toEqual({ n: 3 });
    expect(fresh.prepare("SELECT count(*) AS n FROM creatorPicks").get()).toEqual({ n: 11 });
    expect(fresh.pragma("foreign_key_check")).toEqual([]);
    expect(fresh.pragma("integrity_check", { simple: true })).toBe("ok");
  } finally {
    fresh.close();
  }
});

test("rerunning migrations preserves edited catalog values and existing user tracking", () => {
  const creator = listRecommendationCreators()[0];
  testDb
    .update(recommendationCreators)
    .set({ name: "Edited creator" })
    .where(eq(recommendationCreators.id, creator.id))
    .run();
  const userId = insertUser();
  const titleId = insertTitle();
  insertStatus(userId, titleId, "watchlist");
  applyMigrations();
  expect(listRecommendationCreators()[0].name).toBe("Edited creator");
  expect(listCreatorMoviePicks()).toHaveLength(11);
  expect(testClient.prepare("SELECT count(*) AS n FROM userTitleStatus").get()).toEqual({ n: 1 });
});

test("catalog edits and additions are read without restarting the recommendation service", () => {
  const creator = listRecommendationCreators()[0];
  testDb
    .update(recommendationCreators)
    .set({ name: "New name" })
    .where(eq(recommendationCreators.id, creator.id))
    .run();
  expect(getCreatorCredits(603692, "movie")[0].name).toBe("New name");
  const date = new Date();
  const newCreator = testDb
    .insert(recommendationCreators)
    .values({
      slug: "new-critic",
      name: "New Critic",
      channelUrl: "https://www.youtube.com/channel/UCexample",
      sortOrder: 3,
      createdAt: date,
      updatedAt: date,
    })
    .returning()
    .get()!;
  const video = testDb
    .insert(creatorVideos)
    .values({
      creatorId: newCreator.id,
      videoUrl: "https://www.youtube.com/watch?v=example1234",
      videoTitle: "Best movies",
      publishedAt: "2026-01-01",
      evidenceUrl: "https://www.youtube.com/watch?v=example1234",
      createdAt: date,
      updatedAt: date,
    })
    .returning()
    .get()!;
  testDb
    .insert(creatorPicks)
    .values({
      videoId: video.id,
      tmdbId: 603692,
      movieTitle: "John Wick: Chapter 4",
      startSeconds: 60,
      createdAt: date,
      updatedAt: date,
    })
    .run();
  expect(getRecommendationCreators().at(-1)?.id).toBe("new-critic");
  expect(getCreatorPickIds("new-critic")).toEqual([603692]);
  expect(getCreatorCredits(603692, "movie").map((credit) => credit.name)).toEqual([
    "New name",
    "New Critic",
  ]);
  expect(getCreatorCredits(603692, "movie")[1].videoUrl).toContain("t=60s");
  expect(getCreatorPickIds("missing-critic")).toEqual([]);
});

test("database prevents duplicate picks and orphan videos; cascades leave movie metadata intact", () => {
  const pick = testDb.select().from(creatorPicks).get()!;
  const insert = testClient.prepare(
    "INSERT INTO creatorPicks (id, videoId, tmdbId, type, movieTitle, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  expect(() =>
    insert.run("duplicate", pick.videoId, pick.tmdbId, pick.type, pick.movieTitle, 0, 0),
  ).toThrow(/UNIQUE constraint failed/);
  expect(() =>
    insert.run("orphan", "missing", pick.tmdbId, pick.type, pick.movieTitle, 0, 0),
  ).toThrow(/FOREIGN KEY constraint failed/);
  const creator = listRecommendationCreators()[0];
  const movieId = insertTitle({ tmdbId: 603692 });
  testDb.delete(recommendationCreators).where(eq(recommendationCreators.id, creator.id)).run();
  expect(listCreatorMoviePicks()).toHaveLength(8);
  expect(testClient.pragma("foreign_key_check")).toEqual([]);
  expect(testClient.prepare("SELECT id FROM titles WHERE id = ?").get(movieId)).toEqual({
    id: movieId,
  });
});
