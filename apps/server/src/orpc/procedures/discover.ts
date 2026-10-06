import {
  assertTmdbConfigured,
  browseCatalog,
  getPopularFeed,
  getTmdbGenres,
  getTrendingFeed,
  searchCatalog,
} from "@sofa/core/browse";
import {
  getCreatorCredits,
  getRecommendationCandidates,
  getRecommendationCreators,
} from "@sofa/core/creator-recommendations";
import { getRecommendationSources } from "@sofa/core/discovery";
import {
  getDiscoveryProviderTypes,
  getPlatformTmdbIdMap,
  listPlatforms,
} from "@sofa/core/platforms";
import { verifyRecommendationCandidates } from "@sofa/core/verified-availability";
import { tmdbImageUrl } from "@sofa/tmdb/image";

import { os } from "../context";
import { authed } from "../middleware";

// ─── Trending ─────────────────────────────────────────────────

export const trending = os.discover.trending.use(authed).handler(({ input, context }) => {
  assertTmdbConfigured();
  return getTrendingFeed(context.user.id, input);
});

// ─── Popular ──────────────────────────────────────────────────

export const popular = os.discover.popular.use(authed).handler(({ input, context }) => {
  assertTmdbConfigured();
  return getPopularFeed(context.user.id, input);
});

// ─── Search ───────────────────────────────────────────────────

export const search = os.discover.search.use(authed).handler(({ input }) => {
  assertTmdbConfigured();
  return searchCatalog(input);
});

// ─── Browse (filtered discovery) ──────────────────────────────

export const browse = os.discover.browse.use(authed).handler(({ input, context }) => {
  assertTmdbConfigured();
  return browseCatalog(context.user.id, input);
});

// ─── Genres ───────────────────────────────────────────────────

export const genres = os.discover.genres.use(authed).handler(({ input }) => {
  assertTmdbConfigured();
  return getTmdbGenres(input.type);
});

// ─── Platforms ────────────────────────────────────────────────

export const platforms = os.discover.platforms.use(authed).handler(async () => {
  const allPlatforms = listPlatforms();
  const tmdbIdsMap = getPlatformTmdbIdMap(allPlatforms.map((p) => p.id));
  return {
    platforms: allPlatforms.map((p) => ({
      id: p.id,
      name: p.name,
      tmdbProviderIds: tmdbIdsMap.get(p.id) ?? [],
      logoPath: tmdbImageUrl(p.logoPath, "logos"),
      isSubscription: p.isSubscription,
      accessTypes: getDiscoveryProviderTypes(tmdbIdsMap.get(p.id) ?? []),
    })),
  };
});

// ─── Recommendations ──────────────────────────────────────────

export const recommendations = os.discover.recommendations
  .use(authed)
  .handler(async ({ context, input }) => {
    assertTmdbConfigured();
    const candidates = await getRecommendationCandidates(context.user.id, input?.source);
    if (candidates.length === 0) return { items: [], creators: getRecommendationCreators() };
    const verified = await verifyRecommendationCandidates(
      candidates.map((title) => Object.assign({}, title, { type: title.type as "movie" | "tv" })),
      input?.accessType,
    );
    const sources = getRecommendationSources(
      context.user.id,
      verified.map((title) => title.id),
    );
    const items = verified.slice(0, 10).map((title) => ({
      id: title.id,
      tmdbId: title.tmdbId,
      type: title.type,
      title: title.title,
      posterPath: tmdbImageUrl(title.posterPath, "posters"),
      posterThumbHash: title.posterThumbHash ?? null,
      releaseDate: title.releaseDate ?? null,
      firstAirDate: title.firstAirDate ?? null,
      voteAverage: title.voteAverage ?? null,
      usAvailability: title.usAvailability,
      recommendationSources: sources.get(title.id) ?? [],
      creatorCredits: getCreatorCredits(title.tmdbId, title.type),
    }));
    return { items, creators: getRecommendationCreators() };
  });
