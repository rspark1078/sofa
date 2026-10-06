import { beforeEach, afterEach, expect, test, vi } from "vitest";

import {
  listCreatorMoviePicks,
  listRecommendationCreators,
} from "@sofa/db/queries/creator-recommendations";
import { clearAllTables, insertUser } from "@sofa/test/db";

import {
  getCreatorRefreshStatus,
  parseCreatorFeed,
  refreshDueCreators,
  refreshUserCreators,
} from "../src/creator-refresh";
import { getSetting, setSetting, updateCriticPreferences } from "../src/settings";
import { seedCreatorCatalog } from "./fixtures/creator-catalog";

vi.mock("@sofa/logger", () => ({
  createLogger: () => ({
    error: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    debug: vi.fn<() => void>(),
  }),
}));

function feed(channelId: string, title = "New review &amp; discussion") {
  return `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>${channelId.replace(/^UC/, "")}</yt:channelId><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>${title}</title><published>2026-10-05T12:00:00+00:00</published></entry></feed>`;
}
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  clearAllTables();
  seedCreatorCatalog();
  insertUser("one");
  insertUser("two");
  fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async (url) => new Response(feed(new URL(String(url)).searchParams.get("channel_id")!)),
    );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("parses Atom entities while rejecting wrong identities and unsafe XML", async () => {
  const id = new URL(listRecommendationCreators()[0].channelUrl).pathname.split("/").pop()!;
  expect((await parseCreatorFeed(feed(id), id))[0].videoTitle).toBe("New review & discussion");
  await expect(parseCreatorFeed(feed(id), "wrong")).rejects.toThrow(
    "Creator feed identity mismatch",
  );
  await expect(parseCreatorFeed("<!DOCTYPE feed>" + feed(id), id)).rejects.toThrow(
    "Invalid creator feed",
  );
  await expect(parseCreatorFeed("broken XML", id)).rejects.toThrow(
    /Non-whitespace before first tag/,
  );
});

test("checks only selected channels, deduplicates videos and never invents picks", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "daily" });
  updateCriticPreferences("two", { creatorIds: [], refreshFrequency: "manual" });
  const result = await refreshUserCreators("one");
  expect(result.failed).toBe(false);
  expect(result.lastCheckedAt).not.toBeNull();
  expect(result.videos).toHaveLength(1);
  expect(result.videos[0].creatorSlug).toBe("jeremy-jahns");
  expect(getCreatorRefreshStatus("two").videos).toEqual([]);
  await refreshUserCreators("one");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(listCreatorMoviePicks()).toHaveLength(11);
});

test("schedules daily users when due, skips manual and respects persisted intervals", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "daily" });
  updateCriticPreferences("two", { creatorIds: ["chris-stuckmann"], refreshFrequency: "manual" });
  await refreshDueCreators();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await refreshDueCreators();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  setSetting("user:one:criticLastAttempt", String(Date.now() - 25 * 60 * 60 * 1000));
  const creator = listRecommendationCreators().find((c) => c.slug === "jeremy-jahns")!;
  setSetting(`creator:${creator.id}:lastAttempt`, "0");
  await refreshDueCreators();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(getSetting("user:two:criticLastAttempt")).toBe("0");
});

test("failed network check preserves previous videos and last success", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "daily" });
  const success = await refreshUserCreators("one");
  const creator = listRecommendationCreators().find((c) => c.slug === "jeremy-jahns")!;
  setSetting(`creator:${creator.id}:lastAttempt`, "0");
  fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
  const failed = await refreshUserCreators("one");
  expect(failed.failed).toBe(true);
  expect(failed.lastCheckedAt).toBe(success.lastCheckedAt);
  expect(failed.videos).toEqual(success.videos);
  expect(listCreatorMoviePicks()).toHaveLength(11);
});

test("daily defaults check accounts even before preferences are saved", async () => {
  await refreshDueCreators();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(getCreatorRefreshStatus("one").videos).toHaveLength(3);
  expect(getCreatorRefreshStatus("two").lastCheckedAt).not.toBeNull();
});

test("an in-flight check cannot mark changed selections as refreshed", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "daily" });
  fetchMock.mockImplementation(async (url) => {
    updateCriticPreferences("one", { creatorIds: ["chris-stuckmann"], refreshFrequency: "weekly" });
    return new Response(feed(new URL(String(url)).searchParams.get("channel_id")!));
  });
  const result = await refreshUserCreators("one");
  expect(result.lastCheckedAt).toBeNull();
  expect(result.videos).toEqual([]);
  expect(getSetting("user:one:criticLastAttempt")).toBe("0");
});
