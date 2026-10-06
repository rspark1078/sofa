import type { z } from "zod";

import { CriticPreferences, ExplorePreferences } from "@sofa/api/schemas";
import {
  claimInitialAdmin as queryClaimInitialAdmin,
  getSettingValue,
  getUserCount as queryGetUserCount,
  upsertSetting,
} from "@sofa/db/queries/settings";

export function getSetting(key: string): string | null {
  return getSettingValue(key);
}

export function setSetting(key: string, value: string): void {
  upsertSetting(key, value);
}

export function getUserCount(): number {
  return queryGetUserCount();
}

export function claimInitialAdmin(userId: string): boolean {
  return queryClaimInitialAdmin(userId);
}

export function getInstanceId(): string {
  const existing = getSetting("instanceId");
  if (existing) return existing;
  const id = Bun.randomUUIDv7();
  setSetting("instanceId", id);
  return id;
}

export function isRegistrationOpen(): boolean {
  const userCount = getUserCount();
  if (userCount === 0) return true;

  const setting = getSetting("registrationOpen");
  return setting === "true";
}

export function getExplorePreferences(userId: string): z.infer<typeof ExplorePreferences> {
  const saved = getSetting(`user:${userId}:explore`);
  if (saved) {
    try {
      const result = ExplorePreferences.safeParse(JSON.parse(saved));
      if (result.success) return result.data;
    } catch {
      /* Fall back to defaults for malformed saved preferences. */
    }
  }
  return ExplorePreferences.parse({});
}

export function updateExplorePreferences(
  userId: string,
  preferences: z.infer<typeof ExplorePreferences>,
) {
  const parsed = ExplorePreferences.parse(preferences);
  setSetting(`user:${userId}:explore`, JSON.stringify(parsed));
  return parsed;
}

export function getCriticPreferences(userId: string): z.infer<typeof CriticPreferences> {
  const saved = getSetting(`user:${userId}:critics`);
  if (saved) {
    try {
      const result = CriticPreferences.safeParse(JSON.parse(saved));
      if (result.success) return result.data;
    } catch {
      /* Fall back to defaults for malformed preferences. */
    }
  }
  return CriticPreferences.parse({});
}

export function updateCriticPreferences(
  userId: string,
  preferences: z.infer<typeof CriticPreferences>,
) {
  const parsed = CriticPreferences.parse(preferences);
  parsed.creatorIds = parsed.creatorIds === null ? null : [...new Set(parsed.creatorIds)];
  if (JSON.stringify(getCriticPreferences(userId)) !== JSON.stringify(parsed)) {
    setSetting(`user:${userId}:criticLastAttempt`, "0");
    setSetting(`user:${userId}:criticLastSuccess`, "0");
    setSetting(`user:${userId}:criticRefreshFailed`, "false");
  }
  setSetting(`user:${userId}:critics`, JSON.stringify(parsed));
  return parsed;
}
