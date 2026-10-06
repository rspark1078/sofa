import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import {
  appSettings,
  creatorFeedEntries,
  creatorPicks,
  creatorVideos,
  recommendationCreators,
} from "../schema";

export function listRecommendationCreators() {
  return db
    .select()
    .from(recommendationCreators)
    .orderBy(asc(recommendationCreators.sortOrder), asc(recommendationCreators.slug))
    .all();
}

export function addRecommendationCreator(name: string, channelUrl: string) {
  return db.transaction((tx) => {
    const creators = tx.select().from(recommendationCreators).all();
    if (creators.some((creator) => creator.channelUrl.replace(/\/$/, "") === channelUrl))
      return { error: "duplicate" as const };
    if (creators.length >= 50) return { error: "limit" as const };
    const id = Bun.randomUUIDv7();
    const now = new Date();
    const insertedCreator = tx
      .insert(recommendationCreators)
      .values({
        id,
        slug: `critic-${id}`,
        name,
        channelUrl,
        sortOrder: Math.max(-1, ...creators.map((creator) => creator.sortOrder)) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return { creator: insertedCreator };
  });
}

function pickQuery() {
  return db
    .select({
      id: creatorPicks.id,
      tmdbId: creatorPicks.tmdbId,
      type: creatorPicks.type,
      movieTitle: creatorPicks.movieTitle,
      startSeconds: creatorPicks.startSeconds,
      creatorSlug: recommendationCreators.slug,
      creatorName: recommendationCreators.name,
      channelUrl: recommendationCreators.channelUrl,
      videoUrl: creatorVideos.videoUrl,
      videoTitle: creatorVideos.videoTitle,
      publishedAt: creatorVideos.publishedAt,
      evidenceUrl: creatorVideos.evidenceUrl,
    })
    .from(creatorPicks)
    .innerJoin(creatorVideos, eq(creatorPicks.videoId, creatorVideos.id))
    .innerJoin(recommendationCreators, eq(creatorVideos.creatorId, recommendationCreators.id));
}
export function listCreatorMoviePicks(creatorSlug?: string) {
  return pickQuery()
    .where(
      and(
        eq(creatorPicks.type, "movie"),
        creatorSlug ? eq(recommendationCreators.slug, creatorSlug) : undefined,
      ),
    )
    .orderBy(
      asc(recommendationCreators.sortOrder),
      asc(creatorPicks.sortOrder),
      asc(creatorPicks.id),
    )
    .all();
}
export function getCreatorCreditRows(tmdbId: number, type: "movie" | "tv") {
  return pickQuery()
    .where(and(eq(creatorPicks.tmdbId, tmdbId), eq(creatorPicks.type, type)))
    .orderBy(
      asc(recommendationCreators.sortOrder),
      asc(creatorPicks.sortOrder),
      asc(creatorPicks.id),
    )
    .all();
}

export function saveCreatorFeedEntries(
  creatorId: string,
  entries: { videoId: string; videoTitle: string; publishedAt: string }[],
) {
  db.transaction((tx) => {
    for (const entry of entries)
      tx.insert(creatorFeedEntries)
        .values({ id: Bun.randomUUIDv7(), creatorId, ...entry, discoveredAt: new Date() })
        .onConflictDoNothing()
        .run();
  });
}

export function listRecentCreatorFeedEntries(creatorIds: string[]) {
  if (!creatorIds.length) return [];
  return db
    .select({
      videoId: creatorFeedEntries.videoId,
      videoTitle: creatorFeedEntries.videoTitle,
      publishedAt: creatorFeedEntries.publishedAt,
      creatorSlug: recommendationCreators.slug,
      creatorName: recommendationCreators.name,
    })
    .from(creatorFeedEntries)
    .innerJoin(recommendationCreators, eq(creatorFeedEntries.creatorId, recommendationCreators.id))
    .where(inArray(recommendationCreators.slug, creatorIds))
    .orderBy(desc(creatorFeedEntries.publishedAt))
    .limit(20)
    .all();
}

export function importVerifiedCreatorPicks(
  creatorId: string,
  video: { videoId: string; videoTitle: string; publishedAt: string },
  picks: { tmdbId: number; movieTitle: string; startSeconds: number | null; evidence?: string }[],
) {
  return db.transaction((tx) => {
    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
    const existing = tx
      .select()
      .from(creatorVideos)
      .where(and(eq(creatorVideos.creatorId, creatorId), eq(creatorVideos.videoUrl, videoUrl)))
      .get();
    const now = new Date();
    const videoRow =
      existing ??
      tx
        .insert(creatorVideos)
        .values({
          id: Bun.randomUUIDv7(),
          creatorId,
          videoUrl,
          videoTitle: video.videoTitle,
          publishedAt: video.publishedAt.slice(0, 10),
          evidenceUrl: videoUrl,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    let added = 0;
    for (const [index, pick] of picks.entries()) {
      const row = tx
        .insert(creatorPicks)
        .values({
          id: Bun.randomUUIDv7(),
          videoId: videoRow.id,
          type: "movie",
          tmdbId: pick.tmdbId,
          movieTitle: pick.movieTitle,
          startSeconds: pick.startSeconds,
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning()
        .get();
      if (row) {
        added++;
        tx.insert(appSettings)
          .values({
            key: `creator-pick:${row.id}:provenance`,
            value: JSON.stringify({
              method: "automated",
              model: process.env.CREATOR_PICK_MODEL ?? "explicit-rules",
              evidence: pick.evidence ?? null,
              checkedAt: now.toISOString(),
            }),
          })
          .run();
      }
    }
    return added;
  });
}
