import {
  getAllPlatforms,
  getTmdbProviderIdsByPlatformIds,
  getTmdbProviderIdsForPlatform,
  getUserPlatformIds,
  getUserPlatforms,
  hasUserPlatforms,
  platformIdsExist,
  setUserPlatforms,
} from "@sofa/db/queries/user-platforms";

export function listPlatforms() {
  return getAllPlatforms();
}

export function getUserPlatformList(userId: string) {
  return getUserPlatforms(userId);
}

export function getUserPlatformIdList(userId: string) {
  return getUserPlatformIds(userId);
}

export function updateUserPlatforms(userId: string, platformIds: string[]): void {
  if (platformIds.length > 0 && !platformIdsExist(platformIds)) {
    throw new Error("One or more platform IDs do not exist");
  }
  setUserPlatforms(userId, platformIds);
}

export function hasUserSetPlatforms(userId: string): boolean {
  return hasUserPlatforms(userId);
}

export function getPlatformTmdbIds(platformId: string): number[] {
  return getTmdbProviderIdsForPlatform(platformId);
}

export function getPlatformTmdbIdMap(platformIds: string[]): Map<string, number[]> {
  return getTmdbProviderIdsByPlatformIds(platformIds);
}

// Free/ad-supported offers among Sofa's curated US provider mappings.
// Mixed platforms (e.g. YouTube and Peacock) retain separate paid provider IDs.
const FREE_DISCOVERY_PROVIDER_IDS = new Set([
  73, 83, 191, 192, 207, 209, 212, 300, 332, 387, 457, 538, 575, 2077,
]);

// OnDemandKorea uses the same TMDB provider ID for free and paid offers.
const MIXED_DISCOVERY_PROVIDER_IDS = new Set([575]);

export function getDiscoveryProviderIds(
  providerIds: number[],
  accessType?: "free" | "ads" | "free_or_ads" | "paid",
): number[] {
  if (!accessType) return providerIds;
  return providerIds.filter((id) =>
    accessType === "paid"
      ? !FREE_DISCOVERY_PROVIDER_IDS.has(id) || MIXED_DISCOVERY_PROVIDER_IDS.has(id)
      : FREE_DISCOVERY_PROVIDER_IDS.has(id),
  );
}

export function getDiscoveryProviderTypes(providerIds: number[]): ("free" | "paid")[] {
  const types: ("free" | "paid")[] = [];
  if (getDiscoveryProviderIds(providerIds, "free_or_ads").length > 0) types.push("free");
  if (getDiscoveryProviderIds(providerIds, "paid").length > 0) types.push("paid");
  return types;
}
