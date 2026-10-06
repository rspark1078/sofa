import type { z } from "zod";

import { CreatorCredit, RecommendationCreator, RecommendationSource } from "@sofa/api/schemas";
import {
  getCreatorCreditRows,
  listCreatorMoviePicks,
  listRecommendationCreators,
} from "@sofa/db/queries/creator-recommendations";
import { getAllTrackedTitleIds } from "@sofa/db/queries/discovery";
import { getMovieDetails } from "@sofa/tmdb/client";

import { getRecommendationsFeed } from "./discovery";
import { ensureBrowseTitlesExist } from "./metadata";
import { getCriticPreferences } from "./settings";

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
  const picks = listCreatorMoviePicks(source === "all" ? undefined : source);
  const groups = getRecommendationCreators()
    .filter(
      (creator) =>
        (source === "all" || creator.id === source) &&
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
  return result.slice(0, 50);
}

export async function getRecommendationCandidates(userId: string, source: Source = "all") {
  const personal =
    source === "all" || source === "personal"
      ? getRecommendationsFeed(userId, "all", 50).filter(
          (title): title is NonNullable<typeof title> => title != null,
        )
      : [];
  const ids = getCreatorPickIds(source, getCriticPreferences(userId).creatorIds).slice(0, 50);
  const details: Awaited<ReturnType<typeof getMovieDetails>>[] = [];
  for (let offset = 0; offset < ids.length; offset += 5) {
    details.push(...(await Promise.all(ids.slice(offset, offset + 5).map(getCreatorMovie))));
  }
  const inputs = details.map((movie, index) => ({
    tmdbId: ids[index],
    type: "movie" as const,
    title:
      movie.title ?? listCreatorMoviePicks().find((pick) => pick.tmdbId === ids[index])!.movieTitle,
    posterPath: movie.poster_path ?? null,
    backdropPath: movie.backdrop_path ?? null,
    releaseDate: movie.release_date || null,
    firstAirDate: null,
    overview: movie.overview,
    voteAverage: movie.vote_average ?? null,
  }));
  const local = ensureBrowseTitlesExist(inputs);
  const tracked = new Set(getAllTrackedTitleIds(userId));
  const creators = inputs
    .map((movie) => Object.assign({}, movie, local.get(movie.tmdbId + "-movie")!))
    .filter((movie) => !tracked.has(movie.id));
  // Round-robin preserves personal ranking while giving each creator an equal opportunity.
  return mergeRecommendationCandidates<(typeof creators)[number] | (typeof personal)[number]>(
    personal,
    creators,
  );
}
