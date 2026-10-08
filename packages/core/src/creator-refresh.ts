import { parseStringPromise } from "xml2js";
import { z } from "zod";

import {
  beginCreatorChannelCheck,
  finishCreatorChannelCheck,
  recoverInterruptedCreatorChecks,
  listEligibleCreatorVideos,
} from "@sofa/db/queries/creator-checks";
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
  shouldCheckCreatorVideo,
} from "./creator-pick-extraction";
import { fetchCreatorYouTube, getYouTubeRetryAfter, YouTubeCooldownError } from "./creator-youtube";
import { getCriticPreferences, getSetting, setSetting } from "./settings";

const log = createLogger("creator-refresh");
const HOUR = 60 * 60 * 1000;
type FeedResult = { source: "atom" | "channel_page" | "cache"; videosFound: number };
class ChannelRefreshError extends Error {
  constructor(
    readonly code: string,
    readonly source: FeedResult["source"] | null,
  ) {
    super(code);
  }
}
const pending = new Map<string, Promise<FeedResult>>();
export function recoverInterruptedCreatorRefreshes() {
  return recoverInterruptedCreatorChecks();
}
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

async function refreshCreatorFeed(creator: ReturnType<typeof listRecommendationCreators>[number]) {
  const existing = pending.get(creator.slug);
  if (existing) return { ...(await existing), source: "cache" as const };
  const lastAttemptKey = `creator:${creator.id}:lastAttempt`;
  if (Date.now() - timestamp(lastAttemptKey) < 60_000) {
    if (getSetting(`creator:${creator.id}:error`) === "true")
      throw new ChannelRefreshError("channel_cooldown", "cache");
    return { source: "cache" as const, videosFound: 0 };
  }
  const request = (async () => {
    setSetting(lastAttemptKey, String(Date.now()));
    let source: FeedResult["source"] = "atom";
    try {
      const channel = new URL(creator.channelUrl);
      const match = channel.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})$/);
      if (channel.protocol !== "https:" || channel.hostname !== "www.youtube.com" || !match)
        throw new ChannelRefreshError("invalid_channel", null);
      let entries: { videoId: string; videoTitle: string; publishedAt: string }[];
      try {
        const response = await fetchCreatorYouTube(
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
      } catch (error) {
        if (error instanceof YouTubeCooldownError) throw error;
        source = "channel_page";
        entries = await readCreatorUploads(match[1]);
      }
      saveCreatorFeedEntries(creator.id, entries);
      setSetting(`creator:${creator.id}:lastSuccess`, String(Date.now()));
      setSetting(`creator:${creator.id}:error`, "false");
      return { source, videosFound: entries.length };
    } catch (error) {
      setSetting(`creator:${creator.id}:error`, "true");
      if (error instanceof YouTubeCooldownError)
        throw new ChannelRefreshError("youtube_rate_limited", error.blocked ? "cache" : source);
      throw error instanceof ChannelRefreshError
        ? error
        : new ChannelRefreshError("channel_unavailable", source);
    }
  })();
  pending.set(creator.slug, request);
  try {
    return await request;
  } finally {
    pending.delete(creator.slug);
  }
}

async function checkCreator(
  creator: ReturnType<typeof listRecommendationCreators>[number],
  userId: string,
  trigger: "manual" | "scheduled",
) {
  const channelCheckId = beginCreatorChannelCheck({
    creatorId: creator.id,
    requestedByUserId: userId,
    trigger,
  });
  const coalesced = pending.has(creator.slug);
  try {
    const result = await refreshCreatorFeed(creator);
    finishCreatorChannelCheck(channelCheckId, {
      status: result.source === "cache" ? "cached" : "success",
      source: result.source,
      videosFound: result.videosFound,
      errorCode: null,
    });
    return { channelCheckId, failed: false };
  } catch (error) {
    finishCreatorChannelCheck(channelCheckId, {
      status: "failed",
      source: coalesced ? "cache" : error instanceof ChannelRefreshError ? error.source : null,
      videosFound: 0,
      errorCode: error instanceof ChannelRefreshError ? error.code : "channel_unavailable",
    });
    return { channelCheckId, failed: true };
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

export async function refreshUserCreators(
  userId: string,
  trigger: "manual" | "scheduled" = "manual",
) {
  const preferencesAtStart = JSON.stringify(getCriticPreferences(userId));
  const creators = selectedCreators(userId);
  let failed = creators.length > 50;
  const channelChecks = new Map<string, string>();
  for (const creator of creators.slice(0, 50)) {
    const result = await checkCreator(creator, userId, trigger);
    channelChecks.set(creator.id, result.channelCheckId);
    if (result.failed) {
      failed = true;
      log.error("Creator feed refresh failed", { creator: creator.slug });
    }
  }
  let videosChecked = 0;
  let picksAdded = 0;
  const videos = listRecentCreatorFeedEntries(creators.map((creator) => creator.slug));
  // Retain pending failures in status, but never spend processing slots on cooldowns.
  if (
    videos.some((video) => {
      const creator = creators.find((item) => item.slug === video.creatorSlug)!;
      return (
        getVideoPickCheck(creator.id, video.videoId)?.state === "failed" &&
        !shouldCheckCreatorVideo(creator.id, video.videoId)
      );
    })
  )
    failed = true;
  const lastCreator = getSetting(`user:${userId}:criticScanLastCreator`);
  const nextIndex =
    (creators.findIndex((creator) => creator.slug === lastCreator) + 1) % (creators.length || 1);
  const rotated = [...creators.slice(nextIndex), ...creators.slice(0, nextIndex)];
  const queues = rotated.map((creator) => ({
    creator,
    videos: listEligibleCreatorVideos(creator.id),
  }));
  // Round-robin across creators, retaining progress when there are more than three.
  const work = Array.from({ length: 20 }, (_, index) =>
    queues.flatMap(({ creator, videos: queued }) =>
      queued[index] ? [{ creator, video: queued[index] }] : [],
    ),
  ).flat();
  for (const { creator, video } of work) {
    if (videosChecked >= 3) break;
    if (getYouTubeRetryAfter() > Date.now()) {
      failed = true;
      break;
    }
    if (JSON.stringify(getCriticPreferences(userId)) !== preferencesAtStart) break;
    const result = await processCreatorVideo(
      creator.id,
      creator.channelUrl.split("/").pop()!,
      video,
      channelChecks.get(creator.id),
    );
    if (result.state === "failed") failed = true;
    if (!result.attempted) continue;
    videosChecked++;
    setSetting(`user:${userId}:criticScanLastCreator`, creator.slug);
    picksAdded += result.picksAdded;
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
  let attempted = 0;
  let failed = 0;
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
    if (Date.now() - timestamp(`user:${userId}:criticLastAttempt`) >= retryInterval) {
      attempted++;
      try {
        const result = await refreshUserCreators(userId, "scheduled");
        if (result.failed) failed++;
      } catch {
        // Continue other administrators even if one refresh unexpectedly throws.
        failed++;
        setSetting(`user:${userId}:criticRefreshFailed`, "true");
        setSetting(`user:${userId}:criticLastAttempt`, String(Date.now()));
        log.error("Scheduled creator refresh could not finish", { userId });
      }
    }
  }
  // Cron has success/error outcomes only: partial failures must not appear healthy.
  if (failed > 0)
    throw new Error(
      `Critic refresh incomplete: ${failed} of ${attempted} scheduled account checks failed`,
    );
}
