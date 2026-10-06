import {
  ensurePlatformForTmdbProvider,
  getAvailabilityForTitle,
  replaceAvailabilityTransaction,
} from "@sofa/db/queries/availability";
import { markEnrichmentChecked } from "@sofa/db/queries/metadata";
import { getTitleById } from "@sofa/db/queries/title";
import type { titleAvailability } from "@sofa/db/schema";
import { createLogger } from "@sofa/logger";

import { getVerifiedUsAvailability } from "./verified-availability";

const log = createLogger("availability");

export async function refreshAvailability(titleId: string) {
  const title = getTitleById(titleId);
  if (!title) return;

  const availability = await getVerifiedUsAvailability(title.tmdbId, title.type);
  const now = new Date(availability.checkedAt);
  const allOfferRows: (typeof titleAvailability.$inferInsert)[] = availability.offers.map(
    (offer) => ({
      titleId,
      platformId: ensurePlatformForTmdbProvider(
        offer.providerId,
        offer.providerName,
        offer.logoPath,
      ),
      offerType: offer.offerType,
      region: "US",
      lastFetchedAt: now,
    }),
  );

  replaceAvailabilityTransaction(titleId, "US", allOfferRows);
  markEnrichmentChecked(titleId, "availability", now);

  log.debug(`Refreshed availability for title ${titleId}: ${allOfferRows.length} offers`);
  return availability;
}

export function getAvailability(titleId: string) {
  return getAvailabilityForTitle(titleId);
}
