import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import { auth } from "@sofa/auth/server";
import { AVATAR_DIR } from "@sofa/config";
import {
  addCritic as coreAddCritic,
  getRecommendationCreators,
} from "@sofa/core/creator-recommendations";
import { getCreatorRefreshStatus, refreshUserCreators } from "@sofa/core/creator-refresh";
import {
  getDiscoveryPresets,
  saveDiscoveryPreset as coreSaveDiscoveryPreset,
  deleteDiscoveryPreset as coreDeleteDiscoveryPreset,
} from "@sofa/core/discovery-presets";
import {
  createOrUpdateIntegration,
  deleteIntegration as coreDeleteIntegration,
  listUserIntegrations,
  regenerateToken as coreRegenerateToken,
  serializeIntegration,
} from "@sofa/core/integrations";
import { getUserPlatformIdList, updateUserPlatforms } from "@sofa/core/platforms";
import {
  getCriticPreferences,
  updateCriticPreferences,
  getExplorePreferences,
  updateExplorePreferences,
} from "@sofa/core/settings";

import { os } from "../context";
import { admin, authed } from "../middleware";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const updateName = os.account.updateName.use(authed).handler(async ({ input, context }) => {
  await auth.api.updateUser({
    body: { name: input.name },
    headers: context.headers,
  });
});

export const uploadAvatar = os.account.uploadAvatar
  .use(authed)
  .handler(async ({ input: file, context }) => {
    await mkdir(AVATAR_DIR, { recursive: true });

    const ext = MIME_TO_EXT[file.type] || "jpg";
    const filename = `${context.user.id}.${ext}`;
    const filePath = path.join(AVATAR_DIR, filename);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await Bun.write(tmpPath, file);
    await rename(tmpPath, filePath);

    const glob = new Bun.Glob(`${context.user.id}.*`);
    const existing = await Array.fromAsync(glob.scan(AVATAR_DIR));
    for (const match of existing) {
      if (match !== filename) {
        await Bun.file(path.join(AVATAR_DIR, match)).delete();
      }
    }

    const imageUrl = `/api/avatars/${context.user.id}?v=${Date.now()}`;
    await auth.api.updateUser({
      body: { image: imageUrl },
      headers: context.headers,
    });

    return { imageUrl };
  });

export const removeAvatar = os.account.removeAvatar.use(authed).handler(async ({ context }) => {
  const glob = new Bun.Glob(`${context.user.id}.*`);
  const matches = await Array.fromAsync(glob.scan(AVATAR_DIR));
  for (const match of matches) {
    await Bun.file(path.join(AVATAR_DIR, match)).delete();
  }
  await auth.api.updateUser({
    body: { image: "" },
    headers: context.headers,
  });
});

export const platforms = os.account.platforms.use(authed).handler(async ({ context }) => {
  return { platformIds: getUserPlatformIdList(context.user.id) };
});

export const updatePlatformsHandler = os.account.updatePlatforms
  .use(authed)
  .handler(async ({ input, context }) => {
    updateUserPlatforms(context.user.id, input.platformIds);
  });

// ─── Integrations ─────────────────────────────────────────────

export const integrationsList = os.account.integrations.list.use(authed).handler(({ context }) => {
  return listUserIntegrations(context.user.id);
});

export const integrationsCreate = os.account.integrations.create
  .use(authed)
  .handler(({ input, context }) => {
    return createOrUpdateIntegration(context.user.id, input.provider, input.enabled);
  });

export const integrationsDelete = os.account.integrations.delete
  .use(authed)
  .handler(({ input, context }) => {
    coreDeleteIntegration(context.user.id, input.provider);
  });

export const integrationsRegenerateToken = os.account.integrations.regenerateToken
  .use(authed)
  .handler(({ input, context }) => {
    const row = coreRegenerateToken(context.user.id, input.provider);

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: "Integration not found",
        data: { code: AppErrorCode.INTEGRATION_NOT_FOUND },
      });
    }

    return serializeIntegration(row);
  });

export const explorePreferences = os.account.explorePreferences
  .use(authed)
  .handler(async ({ context }) => getExplorePreferences(context.user.id));
export const updateExplorePreferencesHandler = os.account.updateExplorePreferences
  .use(authed)
  .handler(async ({ context, input }) => updateExplorePreferences(context.user.id, input));

export const discoveryPresets = os.account.discoveryPresets
  .use(authed)
  .handler(({ context }) => getDiscoveryPresets(context.user.id));
export const saveDiscoveryPreset = os.account.saveDiscoveryPreset
  .use(authed)
  .handler(({ context, input }) => coreSaveDiscoveryPreset(context.user.id, input));
export const deleteDiscoveryPreset = os.account.deleteDiscoveryPreset
  .use(authed)
  .handler(({ context, input }) => coreDeleteDiscoveryPreset(context.user.id, input.id));

export const addCritic = os.account.addCritic
  .use(admin)
  .handler(({ input }) => coreAddCritic(input));

export const criticPreferences = os.account.criticPreferences
  .use(authed)
  .handler(({ context }) => ({
    preferences: getCriticPreferences(context.user.id),
    creators: getRecommendationCreators(),
  }));
export const updateCriticPreferencesHandler = os.account.updateCriticPreferences
  .use(authed)
  .handler(({ context, input }) => updateCriticPreferences(context.user.id, input));

export const creatorRefreshStatus = os.account.creatorRefreshStatus
  .use(authed)
  .handler(({ context }) => getCreatorRefreshStatus(context.user.id));
export const refreshCreators = os.account.refreshCreators
  .use(authed)
  .handler(({ context }) => refreshUserCreators(context.user.id));
