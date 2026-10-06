import { parseStringPromise } from "xml2js";
import { z } from "zod";

import {
  listRecommendationCreators,
  listRecentCreatorFeedEntries,
  saveCreatorFeedEntries,
} from "@sofa/db/queries/creator-recommendations";
import { listCreatorRefreshUserIds } from "@sofa/db/queries/settings";
import { createLogger } from "@sofa/logger";

import {
  getVideoPickCheck,
  processCreatorVideo,
  readCreatorUploads,
} from "./creator-pick-extraction";
import { getCriticPreferences, getSetting, setSetting } from "./settings";

const log = createLogger("creator-refresh");
const HOUR = 60 * 60 * 1000;
const pending = new Map<string, Promise<void>>();
const Entry = z.object({
  "yt:videoId": z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).length(1),
  "yt:channelId": z.array(z.string()).length(1),
  title: z.array(z.string().min(1).max(1000)).length(1),
  published: z.array(z.string().datetime({ offset: true })).length(1),
});

export async function parseCreatorFeed(xml: string, channelId: string) {
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Invalid creator feed");
  const parsed: unknown = await parseStringPromise(xml, { strict: true });
  const feed = z
    .object({
      feed: z.object({
        "yt:channelId": z.array(z.string()).length(1),
        entry: z.array(Entry).max(100).default([]),
      }),
    })
    .parse(parsed).feed;
  if (
    (feed["yt:channelId"][0] !== channelId && `UC${feed["yt:channelId"][0]}` !== channelId) ||
    feed.entry.some((entry) => entry["yt:channelId"][0] !== channelId)
  )
    throw new Error("Creator feed identity mismatch");
  return feed.entry.map((entry) => ({
    videoId: entry["yt:videoId"][0],
    videoTitle: entry.title[0],
    publishedAt: new Date(entry.published[0]).toISOString(),
  }));
}

function selectedCreators(userId: string) {
  const ids = getCriticPreferences(userId).creatorIds;
  return listRecommendationCreators().filter(
    (creator) => ids === null || ids.includes(creator.slug),
  );
}

function timestamp(key: string) {
  const value = Number(getSetting(key));
  return Number.isFinite(value) ? value : 0;
}

async function checkCreator(creator: ReturnType<typeof listRecommendationCreators>[number]) {
  const existing = pending.get(creator.slug);
  if (existing) return existing;
  const lastAttemptKey = `creator:${creator.id}:lastAttempt`;
  if (Date.now() - timestamp(lastAttemptKey) < 60_000) {
    if (getSetting(`creator:${creator.id}:error`) === "true")
      throw new Error("Creator refresh failed recently");
    return;
  }
  const request = (async () => {
    setSetting(lastAttemptKey, String(Date.now()));
    try {
      const channel = new URL(creator.channelUrl);
      const match = channel.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})$/);
      if (channel.protocol !== "https:" || channel.hostname !== "www.youtube.com" || !match)
        throw new Error("Unsupported creator channel");
      let entries: { videoId: string; videoTitle: string; publishedAt: string }[];
      try {
        const response = await fetch(
          `https://www.youtube.com/feeds/videos.xml?channel_id=${match[1]}`,
          { signal: AbortSignal.timeout(15_000), redirect: "error" },
        );
        if (!response.ok) throw new Error("Creator feed unavailable");
        if (Number(response.headers.get("content-length")) > 1_000_000)
          throw new Error("Creator feed too large");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty creator feed");
        let xml = "";
        let bytes = 0;
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1_000_000) {
            await reader.cancel();
            throw new Error("Creator feed too large");
          }
          xml += decoder.decode(value, { stream: true });
        }
        xml += decoder.decode();
        entries = await parseCreatorFeed(xml, match[1]);
      } catch {
        entries = await readCreatorUploads(match[1]);
      }
      saveCreatorFeedEntries(creator.id, entries);
      setSetting(`creator:${creator.id}:lastSuccess`, String(Date.now()));
      setSetting(`creator:${creator.id}:error`, "false");
    } catch (error) {
      setSetting(`creator:${creator.id}:error`, "true");
      throw error;
    }
  })();
  pending.set(creator.slug, request);
  try {
    await request;
  } finally {
    pending.delete(creator.slug);
  }
}

export function getCreatorRefreshStatus(userId: string) {
  const creators = selectedCreators(userId);
  const lastChecked = timestamp(`user:${userId}:criticLastSuccess`);
  return {
    lastCheckedAt: lastChecked ? new Date(lastChecked).toISOString() : null,
    failed: getSetting(`user:${userId}:criticRefreshFailed`) === "true",
    videosChecked: timestamp(`user:${userId}:criticVideosChecked`),
    picksAdded: timestamp(`user:${userId}:criticPicksAdded`),
    videos: listRecentCreatorFeedEntries(creators.map((creator) => creator.slug)).map((video) =>
      Object.assign({}, video, {
        pickCheck: getVideoPickCheck(
          creators.find((creator) => creator.slug === video.creatorSlug)!.id,
          video.videoId,
        ),
        videoUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
      }),
    ),
  };
}

export async function refreshUserCreators(userId: string) {
  const preferencesAtStart = JSON.stringify(getCriticPreferences(userId));
  const creators = selectedCreators(userId);
  let failed = creators.length > 50;
  for (const creator of creators.slice(0, 50)) {
    try {
      await checkCreator(creator);
    } catch {
      failed = true;
      log.error("Creator feed refresh failed", { creator: creator.slug });
    }
  }
  let videosChecked = 0;
  let picksAdded = 0;
  const videos = listRecentCreatorFeedEntries(creators.map((creator) => creator.slug));
  for (const video of videos
    .filter((item) => {
      const creator = creators.find((itemCreator) => itemCreator.slug === item.creatorSlug)!;
      const check = getVideoPickCheck(creator.id, item.videoId);
      return !check || check.state === "failed";
    })
    .slice(0, 3)) {
    if (JSON.stringify(getCriticPreferences(userId)) !== preferencesAtStart) break;
    const creator = creators.find((item) => item.slug === video.creatorSlug)!;
    const result = await processCreatorVideo(
      creator.id,
      creator.channelUrl.split("/").pop()!,
      video,
    );
    videosChecked++;
    picksAdded += result.picksAdded;
    if (result.state === "failed") failed = true;
  }
  if (JSON.stringify(getCriticPreferences(userId)) !== preferencesAtStart)
    return getCreatorRefreshStatus(userId);
  setSetting(`user:${userId}:criticVideosChecked`, String(videosChecked));
  setSetting(`user:${userId}:criticPicksAdded`, String(picksAdded));
  setSetting(`user:${userId}:criticLastAttempt`, String(Date.now()));
  setSetting(`user:${userId}:criticRefreshFailed`, String(failed));
  if (!failed) setSetting(`user:${userId}:criticLastSuccess`, String(Date.now()));
  return getCreatorRefreshStatus(userId);
}

export async function refreshDueCreators() {
  for (const userId of listCreatorRefreshUserIds()) {
    const preferences = getCriticPreferences(userId);
    if (preferences.refreshFrequency === "manual") continue;
    const interval =
      preferences.refreshFrequency === "hourly"
        ? HOUR
        : preferences.refreshFrequency === "weekly"
          ? 7 * 24 * HOUR
          : 24 * HOUR;
    const retryInterval =
      getSetting(`user:${userId}:criticRefreshFailed`) === "true"
        ? Math.min(interval, HOUR)
        : interval;
    if (Date.now() - timestamp(`user:${userId}:criticLastAttempt`) >= retryInterval)
      await refreshUserCreators(userId);
  }
}
