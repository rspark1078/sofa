import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { creatorFeedEntries, creatorPicks, creatorVideos, recommendationCreators } from "../schema";

export function listRecommendationCreators() {
  return db
    .select()
    .from(recommendationCreators)
    .orderBy(asc(recommendationCreators.sortOrder), asc(recommendationCreators.slug))
    .all();
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
