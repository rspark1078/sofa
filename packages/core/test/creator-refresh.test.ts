import { eq } from "drizzle-orm";
import { beforeEach, afterEach, expect, test, vi } from "vitest";

import { CreatorRefreshStatus, CreatorVideoPickCheck } from "@sofa/api/schemas";
import {
  listEligibleCreatorVideos,
  beginCreatorVideoCheck,
  updateCreatorVideoCheck,
} from "@sofa/db/queries/creator-checks";
import {
  listCreatorMoviePicks,
  listRecommendationCreators,
  saveCreatorFeedEntries,
} from "@sofa/db/queries/creator-recommendations";
import { creatorChannelChecks, creatorVideoChecks, user } from "@sofa/db/schema";
import { clearAllTables, insertUser, testDb } from "@sofa/test/db";

import {
  getCreatorRefreshStatus,
  parseCreatorFeed,
  refreshDueCreators,
  recoverInterruptedCreatorRefreshes,
  refreshUserCreators,
} from "../src/creator-refresh";
import { getSetting, setSetting, updateCriticPreferences } from "../src/settings";
import { seedCreatorCatalog } from "./fixtures/creator-catalog";

const videoProcessor = vi.hoisted(() =>
  vi.fn<typeof import("../src/creator-pick-extraction").processCreatorVideo>(),
);
const uploadsReader = vi.hoisted(() =>
  vi.fn<typeof import("../src/creator-pick-extraction").readCreatorUploads>(),
);
vi.mock("../src/creator-pick-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/creator-pick-extraction")>()),
  readCreatorUploads: uploadsReader,
  processCreatorVideo: videoProcessor,
}));

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
  uploadsReader.mockReset().mockRejectedValue(new Error("Channel unavailable"));
  videoProcessor.mockReset().mockResolvedValue({
    state: "review",
    picksAdded: 0,
    reason: "Review required",
    attempted: true,
  });
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

test("legacy schedules cannot trigger automatic scans", async () => {
  setSetting(
    "user:one:critics",
    JSON.stringify({ creatorIds: ["jeremy-jahns"], refreshFrequency: "hourly" }),
  );
  setSetting(
    "user:two:critics",
    JSON.stringify({ creatorIds: ["chris-stuckmann"], refreshFrequency: "daily" }),
  );
  await refreshDueCreators();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(getCreatorRefreshStatus("one").lastCheckedAt).toBeNull();
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

test("scheduled scans run for admins only, honor frequency, and stop after demotion", async () => {
  testDb.update(user).set({ role: "admin" }).where(eq(user.id, "one")).run();
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  await refreshDueCreators();
  expect(fetchMock).not.toHaveBeenCalled();
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "hourly" });
  updateCriticPreferences("two", { creatorIds: ["chris-stuckmann"], refreshFrequency: "hourly" });
  await refreshDueCreators();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(getCreatorRefreshStatus("one").lastCheckedAt).not.toBeNull();
  expect(getCreatorRefreshStatus("two").lastCheckedAt).toBeNull();
  await refreshDueCreators();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  testDb.update(user).set({ role: "user" }).where(eq(user.id, "one")).run();
  setSetting("user:one:criticLastAttempt", "0");
  await refreshDueCreators();
  expect(fetchMock).toHaveBeenCalledTimes(1);
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

function auditedCheck(videoId: string, state: "review" | "added" | "failed", retryAt: Date | null) {
  const creator = listRecommendationCreators().find((item) => item.slug === "jeremy-jahns")!;
  const id = beginCreatorVideoCheck({
    creatorId: creator.id,
    videoId,
    videoTitle: "Review",
    publishedAt: "2026-10-06T00:00:00Z",
  });
  updateCreatorVideoCheck(id, { state, retryAt, finishedAt: new Date(), reason: "Test check" });
}
function fourVideoFeed() {
  fetchMock.mockImplementation(async (url) => {
    const id = new URL(String(url)).searchParams.get("channel_id")!;
    const entries = [1, 2, 3, 4]
      .map(
        (i) =>
          `<entry><yt:videoId>abcdefghij${i}</yt:videoId><yt:channelId>${id}</yt:channelId><title>Review ${i}</title><published>2026-10-0${7 - i}T00:00:00Z</published></entry>`,
      )
      .join("");
    return new Response(
      `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>${id}</yt:channelId>${entries}</feed>`,
    );
  });
}
test.each(["review", "added"] as const)("dispatches a due partial %s retry", async (state) => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  auditedCheck("abcdefghijk", state, new Date(Date.now() - 1000));
  const result = await refreshUserCreators("one");
  expect(videoProcessor).toHaveBeenCalledTimes(1);
  expect(result.videosChecked).toBe(1);
});
test("failed cooldowns do not block fresh work or count as checked", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  fourVideoFeed();
  for (const i of [1, 2, 3])
    auditedCheck("abcdefghij" + i, "failed", new Date(Date.now() + 3600_000));
  const result = await refreshUserCreators("one");
  expect(videoProcessor).toHaveBeenCalledTimes(1);
  expect(videoProcessor.mock.calls[0][2].videoId).toBe("abcdefghij4");
  expect(result.videosChecked).toBe(1);
  expect(result.failed).toBe(true);
});
test("cached or coalesced work does not consume the three actual-check slots", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  fourVideoFeed();
  videoProcessor.mockResolvedValueOnce({
    state: "review",
    picksAdded: 0,
    reason: "Already checked",
    attempted: false,
  });
  const result = await refreshUserCreators("one");
  expect(videoProcessor).toHaveBeenCalledTimes(4);
  expect(result.videosChecked).toBe(3);
});
test("legacy success summaries receive an audited recheck instead of being skipped", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  const creator = listRecommendationCreators().find((item) => item.slug === "jeremy-jahns")!;
  setSetting(
    `creator:${creator.id}:video:abcdefghijk:picks`,
    JSON.stringify({ state: "added", picksAdded: 1, reason: "Legacy summary" }),
  );
  expect((await refreshUserCreators("one")).videosChecked).toBe(1);
  expect(videoProcessor).toHaveBeenCalledTimes(1);
});

test("scans older persisted backlog even when a prolific critic fills the latest-20 UI", async () => {
  const creators = listRecommendationCreators();
  updateCriticPreferences("one", { creatorIds: null, refreshFrequency: "manual" });
  saveCreatorFeedEntries(
    creators[0].id,
    Array.from({ length: 25 }, (_, i) => ({
      videoId: `backlog${String(i).padStart(4, "0")}`,
      videoTitle: `Review ${i}`,
      publishedAt: "2026-10-06T00:00:00Z",
    })),
  );
  saveCreatorFeedEntries(creators[1].id, [
    { videoId: "quietcritic", videoTitle: "Older review", publishedAt: "2020-01-01T00:00:00Z" },
  ]);
  expect(
    getCreatorRefreshStatus("one").videos.some((video) => video.videoId === "quietcritic"),
  ).toBe(false);
  fetchMock.mockImplementation(async (url) => {
    const id = new URL(String(url)).searchParams.get("channel_id")!;
    return new Response(`<feed><yt:channelId>${id}</yt:channelId></feed>`);
  });
  await refreshUserCreators("one");
  expect(videoProcessor.mock.calls.some((call) => call[2].videoId === "quietcritic")).toBe(true);
  expect(videoProcessor.mock.calls.some((call) => call[2].videoId === "backlog0000")).toBe(true);
  expect(videoProcessor).toHaveBeenCalledTimes(3);
});

test("creator rotation resumes across refreshes with more than three selected critics", async () => {
  const first = listRecommendationCreators()[0];
  // The seed has three critics; add a fourth through the shared catalog query.
  const { addRecommendationCreator } = await import("@sofa/db/queries/creator-recommendations");
  const added = addRecommendationCreator(
    "Fourth critic",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
  );
  expect(added.creator).toBeDefined();
  updateCriticPreferences("one", { creatorIds: null, refreshFrequency: "manual" });
  await refreshUserCreators("one");
  const firstRound = videoProcessor.mock.calls.map((call) => call[0]);
  expect(new Set(firstRound).size).toBe(3);
  videoProcessor.mockClear();
  await refreshUserCreators("one");
  expect(videoProcessor.mock.calls[0][0]).toBe(added.creator!.id);
  expect(videoProcessor.mock.calls[1][0]).toBe(first.id);
});

test("queue excludes completed and future retries and rotates repeated failures behind unseen work", async () => {
  const creator = listRecommendationCreators()[0];
  const videos = ["completed01", "cooldown001", "dueretry001", "unchecked01"];
  saveCreatorFeedEntries(
    creator.id,
    videos.map((videoId) => ({
      videoId,
      videoTitle: "Review",
      publishedAt: "2020-01-01T00:00:00Z",
    })),
  );
  auditedCheck(videos[0], "review", null);
  auditedCheck(videos[1], "added", new Date(Date.now() + 3600_000));
  auditedCheck(videos[2], "failed", new Date(Date.now() - 10_000));
  expect(listEligibleCreatorVideos(creator.id).map((video) => video.videoId)).toEqual([
    "unchecked01",
    "dueretry001",
  ]);
});

test("successive refreshes drain a backlog larger than twenty without rescanning completed work", async () => {
  const creator = listRecommendationCreators()[0];
  updateCriticPreferences("one", { creatorIds: [creator.slug], refreshFrequency: "manual" });
  fetchMock.mockResolvedValue(
    new Response(
      `<feed><yt:channelId>${creator.channelUrl.split("/").pop()}</yt:channelId></feed>`,
    ),
  );
  const videoIds = Array.from({ length: 25 }, (_, i) => `backlog${String(i).padStart(4, "0")}`);
  saveCreatorFeedEntries(
    creator.id,
    videoIds.map((videoId) => ({
      videoId,
      videoTitle: "Review",
      publishedAt: "2020-01-01T00:00:00Z",
    })),
  );
  videoProcessor.mockImplementation(async (_creatorId, _channelId, video) => {
    auditedCheck(video.videoId, "review", null);
    return { state: "review", reason: "Completed", picksAdded: 0, attempted: true };
  });
  for (let i = 0; i < 9; i++) await refreshUserCreators("one");
  expect(videoProcessor.mock.calls.map((call) => call[2].videoId)).toEqual(videoIds);
  expect(listEligibleCreatorVideos(creator.id)).toEqual([]);
});

test("manual channel audit records discovery and links its video attempts", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  videoProcessor.mockImplementation(async (creatorId, _channelId, video, channelCheckId) => {
    const id = beginCreatorVideoCheck({ creatorId, channelCheckId, ...video });
    updateCreatorVideoCheck(id, { state: "review", finishedAt: new Date() });
    return { state: "review", reason: "Reviewed", picksAdded: 0, attempted: true };
  });
  await refreshUserCreators("one");
  const rows = testDb.select().from(creatorChannelChecks).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    requestedByUserId: "one",
    trigger: "manual",
    status: "success",
    source: "atom",
    videosFound: 1,
    errorCode: null,
  });
  expect(rows[0].finishedAt).not.toBeNull();
  expect(testDb.select().from(creatorVideoChecks).get()?.channelCheckId).toBe(rows[0].id);
  await refreshUserCreators("one");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(testDb.select().from(creatorChannelChecks).all()).toHaveLength(2);
  expect(testDb.select().from(creatorChannelChecks).all()[1]).toMatchObject({
    status: "cached",
    source: "cache",
    videosFound: 0,
  });
});

test("failed discovery and failed cooldown calls both finalize channel audits", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
  expect((await refreshUserCreators("one")).failed).toBe(true);
  expect((await refreshUserCreators("one")).failed).toBe(true);
  const rows = testDb.select().from(creatorChannelChecks).all();
  expect(rows.map((row) => [row.status, row.source, row.errorCode])).toEqual([
    ["failed", "channel_page", "channel_unavailable"],
    ["failed", "cache", "channel_cooldown"],
  ]);
  expect(rows.every((row) => row.finishedAt !== null)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("simultaneous accounts each get a channel audit while sharing the network request", async () => {
  for (const id of ["one", "two"])
    updateCriticPreferences(id, { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  const results = await Promise.all([refreshUserCreators("one"), refreshUserCreators("two")]);
  expect(results.every((result) => !result.failed)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const rows = testDb.select().from(creatorChannelChecks).all();
  expect(rows.map((row) => row.requestedByUserId)).toEqual(["one", "two"]);
  expect(rows.map((row) => row.status)).toEqual(["success", "cached"]);
  expect(rows.map((row) => row.videosFound)).toEqual([1, 1]);
  expect(videoProcessor.mock.calls.every((call) => rows.some((row) => row.id === call[3]))).toBe(
    true,
  );
});

test("scheduled refresh audits retain the initiating admin and scheduled trigger", async () => {
  testDb.update(user).set({ role: "admin" }).where(eq(user.id, "one")).run();
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "hourly" });
  await refreshDueCreators();
  expect(testDb.select().from(creatorChannelChecks).get()).toMatchObject({
    requestedByUserId: "one",
    trigger: "scheduled",
    status: "success",
  });
});

test("startup recovery finalizes only interrupted checks and makes videos retryable", async () => {
  const { beginCreatorChannelCheck, finishCreatorChannelCheck } =
    await import("@sofa/db/queries/creator-checks");
  const creator = listRecommendationCreators()[0];
  const running = beginCreatorChannelCheck({
    creatorId: creator.id,
    requestedByUserId: "one",
    trigger: "manual",
  });
  const completed = beginCreatorChannelCheck({
    creatorId: creator.id,
    requestedByUserId: "one",
    trigger: "manual",
  });
  finishCreatorChannelCheck(completed, { status: "success", source: "atom", videosFound: 1 });
  const video = {
    videoId: "interrupted",
    videoTitle: "Review",
    publishedAt: "2020-01-01T00:00:00Z",
  };
  beginCreatorVideoCheck({ creatorId: creator.id, channelCheckId: running, ...video });
  saveCreatorFeedEntries(creator.id, [video]);
  expect(recoverInterruptedCreatorRefreshes()).toEqual({ channels: 1, videos: 1 });
  expect(recoverInterruptedCreatorRefreshes()).toEqual({ channels: 0, videos: 0 });
  expect(
    testDb.select().from(creatorChannelChecks).where(eq(creatorChannelChecks.id, completed)).get()
      ?.status,
  ).toBe("success");
  expect(testDb.select().from(creatorVideoChecks).get()).toMatchObject({
    state: "failed",
    errorCode: "interrupted",
    channelCheckId: running,
  });
  expect(listEligibleCreatorVideos(creator.id)).toEqual([video]);
});

test("successful fallback discovery records channel-page source and video count", async () => {
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
  uploadsReader.mockResolvedValue([
    { videoId: "abcdefghijk", videoTitle: "Fallback review", publishedAt: "2026-10-06T00:00:00Z" },
  ]);
  expect((await refreshUserCreators("one")).failed).toBe(false);
  expect(testDb.select().from(creatorChannelChecks).get()).toMatchObject({
    status: "success",
    source: "channel_page",
    videosFound: 1,
    errorCode: null,
  });
});

test("coalesced channel failures finalize an audit for every requester", async () => {
  for (const id of ["one", "two"])
    updateCriticPreferences(id, { creatorIds: ["jeremy-jahns"], refreshFrequency: "manual" });
  fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
  const results = await Promise.all([refreshUserCreators("one"), refreshUserCreators("two")]);
  expect(results.every((result) => result.failed)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const rows = testDb.select().from(creatorChannelChecks).all();
  expect(rows.map((row) => [row.status, row.source, row.errorCode])).toEqual([
    ["failed", "channel_page", "channel_unavailable"],
    ["failed", "cache", "channel_unavailable"],
  ]);
  expect(rows.every((row) => row.finishedAt !== null)).toBe(true);
});

test("API status preserves persisted diagnostics, retry timing, counts and partial coverage", () => {
  const creator = listRecommendationCreators()[0];
  updateCriticPreferences("one", { creatorIds: [creator.slug], refreshFrequency: "manual" });
  const video = {
    videoId: "abcdefghijk",
    videoTitle: "Review",
    publishedAt: "2026-10-06T00:00:00Z",
  };
  saveCreatorFeedEntries(creator.id, [video]);
  const id = beginCreatorVideoCheck({ creatorId: creator.id, ...video });
  const retryAt = new Date("2099-01-01T00:00:00Z");
  updateCreatorVideoCheck(id, {
    state: "added",
    finishedAt: new Date(),
    retryAt,
    errorCode: "captions_rate_limited",
    moviesDiscussed: 5,
    moviesRecommended: 2,
    picksAdded: 1,
    sourceKind: "description",
    sourceCharacters: 30000,
    analyzedCharacters: 24000,
  });
  const check = CreatorRefreshStatus.parse(getCreatorRefreshStatus("one")).videos[0].pickCheck;
  expect(check).toMatchObject({
    code: "captions_rate_limited",
    retryAt: retryAt.toISOString(),
    moviesDiscussed: 5,
    moviesRecommended: 2,
    picksAdded: 1,
    sourceKind: "description",
    sourceCharacters: 30000,
    analyzedCharacters: 24000,
  });
});

test("shared check schema accepts legacy results and unknown codes without leaking internal fields", () => {
  const legacy = { state: "review", picksAdded: 0, reason: "Legacy check" };
  expect(CreatorVideoPickCheck.parse(legacy)).toEqual(legacy);
  expect(CreatorVideoPickCheck.parse({ ...legacy, code: "future_code", attempted: true })).toEqual({
    ...legacy,
    code: "future_code",
  });
  expect(CreatorVideoPickCheck.safeParse({ ...legacy, moviesDiscussed: -1 }).success).toBe(false);
  expect(CreatorVideoPickCheck.safeParse({ ...legacy, retryAt: "invalid" }).success).toBe(false);
});

function scheduledAdmins() {
  for (const id of ["one", "two"])
    testDb.update(user).set({ role: "admin" }).where(eq(user.id, id)).run();
  updateCriticPreferences("one", { creatorIds: ["jeremy-jahns"], refreshFrequency: "hourly" });
  updateCriticPreferences("two", { creatorIds: ["chris-stuckmann"], refreshFrequency: "hourly" });
}

test("a total scheduled channel outage rejects after processing every due account", async () => {
  scheduledAdmins();
  fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
  await expect(refreshDueCreators()).rejects.toThrow("2 of 2 scheduled account checks failed");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(getCreatorRefreshStatus("one").failed).toBe(true);
  expect(getCreatorRefreshStatus("two").failed).toBe(true);
  expect(listCreatorMoviePicks()).toHaveLength(11);
});

test("mixed scheduled results preserve successful accounts but mark the job incomplete", async () => {
  scheduledAdmins();
  const failedChannel = listRecommendationCreators()[0].channelUrl.split("/").pop();
  fetchMock.mockImplementation(async (url) => {
    const id = new URL(String(url)).searchParams.get("channel_id")!;
    return id === failedChannel
      ? new Response("Unavailable", { status: 503 })
      : new Response(feed(id));
  });
  await expect(refreshDueCreators()).rejects.toThrow("1 of 2 scheduled account checks failed");
  expect(getCreatorRefreshStatus("one").failed).toBe(true);
  expect(getCreatorRefreshStatus("two").failed).toBe(false);
  expect(getCreatorRefreshStatus("two").lastCheckedAt).not.toBeNull();
});

test("model/video failures propagate to the scheduled job even when channel discovery succeeds", async () => {
  scheduledAdmins();
  videoProcessor.mockResolvedValue({
    state: "failed",
    picksAdded: 0,
    reason: "Model unavailable",
    attempted: true,
  });
  await expect(refreshDueCreators()).rejects.toThrow("2 of 2 scheduled account checks failed");
  expect(
    testDb
      .select()
      .from(creatorChannelChecks)
      .all()
      .every((row) => row.status === "success"),
  ).toBe(true);
});

test("unexpected failures do not prevent later administrators from being refreshed", async () => {
  scheduledAdmins();
  videoProcessor.mockRejectedValueOnce(new Error("private diagnostic"));
  await expect(refreshDueCreators()).rejects.toThrow("1 of 2 scheduled account checks failed");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(getCreatorRefreshStatus("one").failed).toBe(true);
  expect(getCreatorRefreshStatus("two").lastCheckedAt).not.toBeNull();
});

test("feed 429 stops fallback, subsequent channels and video processing across refreshes", async () => {
  updateCriticPreferences("one", { creatorIds: null, refreshFrequency: "manual" });
  fetchMock.mockResolvedValue(new Response("Limited", { status: 429 }));
  const result = await refreshUserCreators("one");
  expect(result.failed).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(uploadsReader).not.toHaveBeenCalled();
  expect(videoProcessor).not.toHaveBeenCalled();
  expect(
    testDb
      .select()
      .from(creatorChannelChecks)
      .all()
      .every((row) => row.status === "failed"),
  ).toBe(true);
  await refreshUserCreators("one");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
