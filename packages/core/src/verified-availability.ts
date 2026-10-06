import { getWatchProviders } from "@sofa/tmdb/client";

export const US_OFFER_TYPES = ["free", "ads", "flatrate", "rent", "buy"] as const;
export type UsOfferType = (typeof US_OFFER_TYPES)[number];
export interface VerifiedUsOffer {
  providerId: number;
  providerName: string;
  offerType: UsOfferType;
  logoPath: string | null;
}
export interface VerifiedUsAvailability {
  offers: VerifiedUsOffer[];
  watchPageUrl: string | null;
  checkedAt: string;
}

const TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const cache = new Map<string, { expiresAt: number; data: VerifiedUsAvailability }>();
const pending = new Map<string, Promise<VerifiedUsAvailability>>();

export function clearVerifiedAvailabilityCache() {
  cache.clear();
}

export async function getVerifiedUsAvailability(tmdbId: number, type: "movie" | "tv") {
  const key = type + ":" + tmdbId;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const data = await getWatchProviders(tmdbId, type);
    const us = data.results?.US;
    const result: VerifiedUsAvailability = {
      offers: US_OFFER_TYPES.flatMap((offerType) =>
        (us?.[offerType] ?? []).map((provider) => ({
          providerId: provider.provider_id,
          providerName: provider.provider_name ?? "",
          offerType,
          logoPath: provider.logo_path ?? null,
        })),
      ),
      watchPageUrl: us?.link ?? null,
      checkedAt: new Date().toISOString(),
    };
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { data: result, expiresAt: Date.now() + TTL_MS });
    return result;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

export function matchingUsOffers(
  offers: VerifiedUsOffer[],
  accessType?: "free" | "ads" | "free_or_ads" | "paid" | "all",
  providerIds?: number[],
) {
  const allowed =
    accessType === "free_or_ads" || accessType === "free"
      ? accessType === "free"
        ? ["free"]
        : ["free", "ads"]
      : accessType === "ads"
        ? ["ads"]
        : accessType === "paid"
          ? ["flatrate", "rent", "buy"]
          : [...US_OFFER_TYPES];
  return offers.filter(
    (offer) =>
      allowed.includes(offer.offerType) && (!providerIds || providerIds.includes(offer.providerId)),
  );
}

// Keep requests bounded, preserving the candidate order.
export async function verifyUsCandidates<T extends { tmdbId: number; type: "movie" | "tv" }>(
  candidates: T[],
  accessType?: "free" | "ads" | "free_or_ads" | "paid" | "all",
  providerIds?: number[],
  limit = candidates.length,
) {
  const results: (T & { usAvailability: VerifiedUsAvailability })[] = [];
  for (let offset = 0; offset < candidates.length && results.length < limit; offset += 5) {
    const batch = await Promise.all(
      candidates.slice(offset, offset + 5).map(async (candidate) => {
        const availability = await getVerifiedUsAvailability(candidate.tmdbId, candidate.type);
        const offers = matchingUsOffers(availability.offers, accessType, providerIds);
        if (((accessType && accessType !== "all") || providerIds) && offers.length === 0)
          return null;
        return Object.assign({}, candidate, { usAvailability: { ...availability, offers } });
      }),
    );
    results.push(...batch.filter((item): item is NonNullable<typeof item> => item !== null));
  }
  return results.slice(0, limit);
}

export function verifyRecommendationCandidates<T extends { tmdbId: number; type: "movie" | "tv" }>(
  candidates: T[],
  accessType: "all" | "free" | "paid" = "all",
) {
  return verifyUsCandidates(
    candidates,
    accessType === "free" ? "free_or_ads" : accessType,
    undefined,
    10,
  );
}
