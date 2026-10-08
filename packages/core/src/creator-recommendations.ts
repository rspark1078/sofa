import { ORPCError } from "@orpc/server";
import type { z } from "zod";

import { AppErrorCode } from "@sofa/api/errors";
import {
  AddRecommendationCreatorInput,
  CreatorCredit,
  RecommendationCreator,
  RecommendationSource,
} from "@sofa/api/schemas";
import {
  addRecommendationCreator,
  getCreatorCreditRows,
  listCreatorMoviePicks,
  listRecommendationCreators,
} from "@sofa/db/queries/creator-recommendations";
import { getAllTrackedTitleIds } from "@sofa/db/queries/discovery";
import { getMovieDetails } from "@sofa/tmdb/client";

import { getRecommendationsFeed } from "./discovery";
import { ensureBrowseTitlesExist } from "./metadata";
import { getCriticPreferences, getSetting } from "./settings";

export function addCritic(input: z.infer<typeof AddRecommendationCreatorInput>) {
  const parsed = AddRecommendationCreatorInput.parse(input);
  const result = addRecommendationCreator(parsed.name, parsed.channelUrl.replace(/\/$/, ""));
  if (result.error === "duplicate") throw new ORPCError("CONFLICT");
  if (result.error === "limit") throw new ORPCError("BAD_REQUEST");
  return RecommendationCreator.parse({
    id: result.creator.slug,
    name: result.creator.name,
    channelUrl: result.creator.channelUrl,
  });
}

type Source = z.infer<typeof RecommendationSource>;
export function getRecommendationCreators() {
  return listRecommendationCreators().map((creator) =>
    RecommendationCreator.parse({
      id: creator.slug,
      name: creator.name,
      channelUrl: creator.channelUrl,
    }),
  );
}

// Read credits from the database every time so catalog edits do not require a restart.
export function getCreatorCredits(tmdbId: number, type: string): z.infer<typeof CreatorCredit>[] {
  if (type !== "movie") return [];
  return getCreatorCreditRows(tmdbId, type).map((pick) => {
    const videoUrl = new URL(pick.videoUrl);
    if (pick.startSeconds != null) videoUrl.searchParams.set("t", pick.startSeconds + "s");
    return CreatorCredit.parse({
      id: pick.creatorSlug,
      origin: getSetting(`creator-pick:${pick.id}:provenance`) ? "automated" : "curated",
      name: pick.creatorName,
      channelUrl: pick.channelUrl,
      videoUrl: videoUrl.toString(),
      videoTitle: pick.videoTitle,
      publishedAt: pick.publishedAt,
    });
  });
}

export function getCreatorPickIds(
  source: Source = "all",
  selectedCreatorIds: string[] | null = null,
) {
  if (source === "personal") return [];
  const picks = listCreatorMoviePicks(
    source === "all" || source === "critics" ? undefined : source,
  );
  const groups = getRecommendationCreators()
    .filter(
      (creator) =>
        (source === "all" || source === "critics" || creator.id === source) &&
        (selectedCreatorIds === null || selectedCreatorIds.includes(creator.id)),
    )
    .map((creator) => picks.filter((pick) => pick.creatorSlug === creator.id));
  return [
    ...new Set(
      Array.from({ length: Math.max(0, ...groups.map((group) => group.length)) }, (_, index) =>
        groups.flatMap((group) => (group[index] ? [group[index].tmdbId] : [])),
      ).flat(),
    ),
  ];
}

const movies = new Map<
  number,
  { expiresAt: number; data: Awaited<ReturnType<typeof getMovieDetails>> }
>();
const pending = new Map<number, ReturnType<typeof getMovieDetails>>();
export function clearCreatorMovieCache() {
  movies.clear();
}
async function getCreatorMovie(tmdbId: number) {
  const cached = movies.get(tmdbId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const inflight = pending.get(tmdbId);
  if (inflight) return inflight;
  const request = getMovieDetails(tmdbId).then((data) => {
    if (data.id !== tmdbId) throw new Error("Creator movie identity mismatch");
    if (movies.size >= 500) movies.delete(movies.keys().next().value!);
    movies.set(tmdbId, { data, expiresAt: Date.now() + 60 * 60 * 1000 });
    return data;
  });
  pending.set(tmdbId, request);
  try {
    return await request;
  } finally {
    pending.delete(tmdbId);
  }
}

export function mergeRecommendationCandidates<T extends { tmdbId: number; type: string }>(
  personal: T[],
  creators: T[],
) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (let index = 0; index < Math.max(personal.length, creators.length); index++) {
    for (const item of [personal[index], creators[index]]) {
      if (!item) continue;
      const key = item.type + ":" + item.tmdbId;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
  }
  return result;
}

function recommendationReferences(userId: string, source: Source) {
  const personal =
    source === "all" || source === "personal"
      ? getRecommendationsFeed(userId, "all", Infinity).filter(
          (title): title is NonNullable<typeof title> => title != null,
        )
      : [];
  const creators = getCreatorPickIds(source, getCriticPreferences(userId).creatorIds).map(
    (tmdbId) => ({ tmdbId, type: "movie" as const }),
  );
  const references = mergeRecommendationCandidates<{ tmdbId: number; type: string }>(
    personal,
    creators,
  );
  return { personal, references };
}

async function resolveRecommendationReferences(
  userId: string,
  pool: ReturnType<typeof recommendationReferences>,
  references: ReturnType<typeof recommendationReferences>["references"],
) {
  const personalByIdentity = new Map(
    pool.personal.map((title) => [title.type + ":" + title.tmdbId, title]),
  );
  const creatorReferences = references.filter(
    (title) => !personalByIdentity.has(title.type + ":" + title.tmdbId),
  );
  const details: Awaited<ReturnType<typeof getMovieDetails>>[] = [];
  for (let offset = 0; offset < creatorReferences.length; offset += 5) {
    details.push(
      ...(await Promise.all(
        creatorReferences.slice(offset, offset + 5).map((title) => getCreatorMovie(title.tmdbId)),
      )),
    );
  }
  const inputs = details.map((movie) => ({
    tmdbId: movie.id,
    type: "movie" as const,
    title:
      movie.title ?? listCreatorMoviePicks().find((pick) => pick.tmdbId === movie.id)!.movieTitle,
    posterPath: movie.poster_path ?? null,
    backdropPath: movie.backdrop_path ?? null,
    releaseDate: movie.release_date || null,
    firstAirDate: null,
    overview: movie.overview,
    voteAverage: movie.vote_average ?? null,
  }));
  const local = ensureBrowseTitlesExist(inputs);
  const creatorsByIdentity = new Map(
    inputs.map((movie) => [
      movie.type + ":" + movie.tmdbId,
      Object.assign({}, movie, local.get(movie.tmdbId + "-movie")!),
    ]),
  );
  const tracked = new Set(getAllTrackedTitleIds(userId));
  return references
    .map(
      (reference) =>
        personalByIdentity.get(reference.type + ":" + reference.tmdbId) ??
        creatorsByIdentity.get(reference.type + ":" + reference.tmdbId),
    )
    .filter((movie): movie is NonNullable<typeof movie> => movie != null && !tracked.has(movie.id));
}

export async function getRecommendationCandidates(userId: string, source: Source = "all") {
  const pool = recommendationReferences(userId, source);
  return resolveRecommendationReferences(userId, pool, pool.references);
}

// A scrolling session retains its original candidate ordering while tracking and
// availability are checked afresh per batch. Cursors are scoped to their owner/filters.
const pageSessions = new Map<
  string,
  {
    userId: string;
    source: Source;
    accessType: string;
    creatorIds: string;
    pool: ReturnType<typeof recommendationReferences>;
    expiresAt: number;
  }
>();
const PAGE_SESSION_TTL = 60 * 60 * 1000;
export function clearRecommendationPageSessions() {
  pageSessions.clear();
}
function expiredPage(): never {
  throw new ORPCError("CONFLICT", { data: { code: AppErrorCode.RECOMMENDATION_SESSION_EXPIRED } });
}
export async function getRecommendationCandidatePage(
  userId: string,
  source: Source = "all",
  cursor: string | null = null,
  limit = 20,
  accessType = "all",
) {
  const now = Date.now();
  for (const [key, session] of pageSessions) if (session.expiresAt <= now) pageSessions.delete(key);
  const creatorIds = JSON.stringify(getCriticPreferences(userId).creatorIds);
  let id: string;
  let offset = 0;
  let session: NonNullable<ReturnType<typeof pageSessions.get>>;
  if (cursor !== null) {
    const match = /^([a-f0-9-]{36}):([0-9]+)$/.exec(cursor);
    if (!match) expiredPage();
    id = match[1];
    offset = Number(match[2]);
    const existing = pageSessions.get(id);
    if (
      !existing ||
      existing.userId !== userId ||
      existing.source !== source ||
      existing.accessType !== accessType ||
      existing.creatorIds !== creatorIds ||
      !Number.isSafeInteger(offset) ||
      offset <= 0 ||
      offset >= existing.pool.references.length
    )
      expiredPage();
    session = existing;
  } else {
    id = crypto.randomUUID();
    session = {
      userId,
      source,
      accessType,
      creatorIds,
      pool: recommendationReferences(userId, source),
      expiresAt: now + PAGE_SESSION_TTL,
    };
    // Limit retained sessions globally and per account; eviction is recoverable in the UI.
    const own = [...pageSessions].filter(([, value]) => value.userId === userId);
    if (own.length >= 4) pageSessions.delete(own[0][0]);
    if (pageSessions.size >= 100) pageSessions.delete(pageSessions.keys().next().value!);
    pageSessions.set(id, session);
  }
  const end = Math.min(offset + limit, session.pool.references.length);
  const candidates = await resolveRecommendationReferences(
    userId,
    session.pool,
    session.pool.references.slice(offset, end),
  );
  return { candidates, nextCursor: end < session.pool.references.length ? `${id}:${end}` : null };
}
