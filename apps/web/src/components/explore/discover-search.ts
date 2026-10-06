import { z } from "zod";

import { DiscoverInput } from "@sofa/api/schemas";

export const discoverSearchSchema = z.object({
  type: DiscoverInput.shape.type.optional().catch(undefined),
  genreId: DiscoverInput.shape.genreId.optional().catch(undefined),
  yearMin: DiscoverInput.shape.yearMin.optional().catch(undefined),
  yearMax: DiscoverInput.shape.yearMax.optional().catch(undefined),
  ratingMin: DiscoverInput.shape.ratingMin.optional().catch(undefined),
  sortBy: DiscoverInput.shape.sortBy.optional().catch(undefined),
  language: DiscoverInput.shape.language.optional().catch(undefined),
  originCountry: DiscoverInput.shape.originCountry.optional().catch(undefined),
  certification: DiscoverInput.shape.certification.optional().catch(undefined),
  accessType: DiscoverInput.shape.accessType
    .optional()
    .catch(undefined)
    .transform((value) => (value === "free" || value === "ads" ? "free_or_ads" : value)),
  platformId: DiscoverInput.shape.platformId.optional().catch(undefined),
  platformIds: DiscoverInput.shape.platformIds.optional().catch(undefined),
});

export type DiscoverSearch = z.infer<typeof discoverSearchSchema>;
