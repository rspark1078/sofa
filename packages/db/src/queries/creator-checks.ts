import { and, asc, desc, eq, isNotNull, or, isNull, lte, sql } from "drizzle-orm";

import { db } from "../client";
import {
  creatorChannelChecks,
  creatorVideoChecks,
  creatorMovieObservations,
  creatorFeedEntries,
} from "../schema";
export function beginCreatorChannelCheck(
  input: Pick<
    typeof creatorChannelChecks.$inferInsert,
    "creatorId" | "requestedByUserId" | "trigger"
  >,
) {
  const id = Bun.randomUUIDv7();
  db.insert(creatorChannelChecks)
    .values({ id, ...input, status: "running", startedAt: new Date() })
    .run();
  return id;
}
export function finishCreatorChannelCheck(
  id: string,
  input: Pick<
    typeof creatorChannelChecks.$inferInsert,
    "status" | "source" | "videosFound" | "errorCode"
  >,
) {
  db.update(creatorChannelChecks)
    .set({ ...input, finishedAt: new Date() })
    .where(eq(creatorChannelChecks.id, id))
    .run();
}
export function beginCreatorVideoCheck(
  input: Pick<
    typeof creatorVideoChecks.$inferInsert,
    "creatorId" | "channelCheckId" | "videoId" | "videoTitle" | "publishedAt" | "model"
  >,
) {
  const id = Bun.randomUUIDv7();
  db.insert(creatorVideoChecks)
    .values({ id, ...input, state: "running", stage: "evidence", startedAt: new Date() })
    .run();
  return id;
}
export function updateCreatorVideoCheck(
  id: string,
  input: Partial<Omit<typeof creatorVideoChecks.$inferInsert, "id" | "creatorId" | "videoId">>,
) {
  db.update(creatorVideoChecks).set(input).where(eq(creatorVideoChecks.id, id)).run();
}
export function getLatestCreatorVideoCheck(creatorId: string, videoId: string) {
  return (
    db
      .select()
      .from(creatorVideoChecks)
      .where(
        and(
          eq(creatorVideoChecks.creatorId, creatorId),
          eq(creatorVideoChecks.videoId, videoId),
          isNotNull(creatorVideoChecks.finishedAt),
        ),
      )
      .orderBy(desc(creatorVideoChecks.startedAt), desc(creatorVideoChecks.id))
      .get() ?? null
  );
}
export function saveCreatorMovieObservations(
  videoCheckId: string,
  observations: Omit<
    typeof creatorMovieObservations.$inferInsert,
    "id" | "videoCheckId" | "createdAt"
  >[],
) {
  return db.transaction((tx) =>
    observations.map((movie) =>
      tx
        .insert(creatorMovieObservations)
        .values({ id: Bun.randomUUIDv7(), videoCheckId, ...movie, createdAt: new Date() })
        .returning()
        .get(),
    ),
  );
}
export function updateCreatorMovieMatch(
  id: string,
  matchStatus: "matched" | "ambiguous" | "unavailable",
  tmdbId: number | null,
  imdbId: string | null = null,
) {
  db.update(creatorMovieObservations)
    .set({ matchStatus, tmdbId, imdbId })
    .where(eq(creatorMovieObservations.id, id))
    .run();
}
export function listCreatorMovieObservations(videoCheckId: string) {
  return db
    .select()
    .from(creatorMovieObservations)
    .where(eq(creatorMovieObservations.videoCheckId, videoCheckId))
    .all();
}

// Scan persisted discoveries independently of the latest-20 presentation window.
export function listEligibleCreatorVideos(creatorId: string, limit = 20) {
  return (
    db
      .select({
        videoId: creatorFeedEntries.videoId,
        videoTitle: creatorFeedEntries.videoTitle,
        publishedAt: creatorFeedEntries.publishedAt,
      })
      .from(creatorFeedEntries)
      .leftJoin(
        creatorVideoChecks,
        eq(
          creatorVideoChecks.id,
          sql`(
      select latest.id from ${creatorVideoChecks} as latest
      where latest."creatorId" = ${creatorFeedEntries.creatorId}
        and latest."videoId" = ${creatorFeedEntries.videoId} and latest."finishedAt" is not null
      order by latest."startedAt" desc, latest.id desc limit 1
    )`,
        ),
      )
      .where(
        and(
          eq(creatorFeedEntries.creatorId, creatorId),
          or(
            isNull(creatorVideoChecks.id),
            lte(creatorVideoChecks.retryAt, new Date()),
            and(isNull(creatorVideoChecks.retryAt), eq(creatorVideoChecks.state, "failed")),
          ),
        ),
      )
      // Unchecked discoveries first; repeated failures rotate behind other work.
      .orderBy(
        asc(sql`coalesce(${creatorVideoChecks.startedAt}, 0)`),
        asc(creatorFeedEntries.publishedAt),
        asc(creatorFeedEntries.videoId),
      )
      .limit(limit)
      .all()
  );
}

// Startup-only recovery: the single server process has no surviving work after restart.
export function recoverInterruptedCreatorChecks() {
  return db.transaction((tx) => {
    const finishedAt = new Date();
    const channels = tx
      .update(creatorChannelChecks)
      .set({ status: "failed", finishedAt, errorCode: "interrupted" })
      .where(eq(creatorChannelChecks.status, "running"))
      .run().changes;
    const videos = tx
      .update(creatorVideoChecks)
      .set({
        state: "failed",
        finishedAt,
        retryAt: finishedAt,
        errorCode: "interrupted",
        reason: "Check interrupted by server restart",
      })
      .where(eq(creatorVideoChecks.state, "running"))
      .run().changes;
    return { channels, videos };
  });
}
