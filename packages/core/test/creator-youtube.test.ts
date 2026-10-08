import { writeFile } from "node:fs/promises";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { clearAllTables } from "@sofa/test/db";

import {
  boundedText,
  readCreatorUploads,
  readVideoEvidenceDetails,
} from "../src/creator-pick-extraction";
import {
  fetchCreatorYouTube,
  getYouTubeRetryAfter,
  pauseYouTubeRequests,
} from "../src/creator-youtube";
import { setSetting } from "../src/settings";

const videoId = "abcdefghijk";
const channelId = "UCabcdefghijklmnopqrstuv";
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  clearAllTables();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CREATOR_CAPTION_TOOL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("watch-page 429 blocks other endpoints until the persisted cooldown ends", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
  fetchMock.mockResolvedValueOnce(
    new Response("Limited", { status: 429, headers: { "Retry-After": "120" } }),
  );
  await expect(readVideoEvidenceDetails(videoId, channelId)).rejects.toMatchObject({
    retryAt: 220000,
  });
  await expect(readCreatorUploads(channelId)).rejects.toMatchObject({ retryAt: 220000 });
  await expect(boundedText(`https://www.youtube.com/watch?v=${videoId}`, 100)).rejects.toThrow(
    "paused",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(220001);
  fetchMock.mockResolvedValueOnce(new Response("Available"));
  expect(await boundedText(`https://www.youtube.com/watch?v=${videoId}`, 100)).toBe("Available");
});

test("caption 429 preserves description evidence but blocks watch pages and subtitle fallback", async () => {
  vi.stubEnv("CREATOR_CAPTION_TOOL", "/should-not-run");
  fetchMock.mockResolvedValueOnce(
    new Response(
      "var ytInitialPlayerResponse = " +
        JSON.stringify({
          videoDetails: { videoId, channelId, shortDescription: "A recommendation." },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  languageCode: "en",
                  baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}`,
                },
              ],
            },
          },
        }) +
        ";</script>",
    ),
  );
  fetchMock.mockResolvedValueOnce(new Response("Limited", { status: 429 }));
  const evidence = await readVideoEvidenceDetails(videoId, channelId);
  expect(evidence).toMatchObject({
    text: "A recommendation.",
    sourceKind: "description",
    code: "captions_rate_limited",
  });
  expect(Date.parse(evidence.retryAt!)).toBe(getYouTubeRetryAfter());
  await expect(readVideoEvidenceDetails(videoId, channelId)).rejects.toThrow("paused");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("legacy caption cooldown also blocks the initial watch-page request", async () => {
  setSetting("creatorCaptionsRetryAfter", String(Date.now() + 3600000));
  await expect(readVideoEvidenceDetails(videoId, channelId)).rejects.toThrow("paused");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("Retry-After dates are bounded and later cooldowns cannot be shortened", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
  expect(pauseYouTubeRequests(new Date(400000).toUTCString())).toBe(400000);
  expect(pauseYouTubeRequests("10")).toBe(400000);
  expect(pauseYouTubeRequests("invalid")).toBe(3700000);
  expect(pauseYouTubeRequests("999999999999")).toBe(100000 + 24 * 3600000);
  clock.mockRestore();
});

test("non-429 failures do not start provider-wide backoff", async () => {
  fetchMock.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
  expect((await fetchCreatorYouTube("https://www.youtube.com/feeds/videos.xml")).status).toBe(503);
  expect(getYouTubeRetryAfter()).toBe(0);
});

test("subtitle-tool 429 also persists shared backoff and disables its internal retries", async () => {
  vi.stubEnv("CREATOR_CAPTION_TOOL", "/mock-caption-tool");
  const spawn = vi.fn<
    (_args: string[], options: { stderr: string }) => { exited: Promise<number>; kill: () => void }
  >((_args, options) => ({
    exited: writeFile(options.stderr, "HTTP Error 429: Too Many Requests").then(() => 1),
    kill: () => undefined,
  }));
  vi.stubGlobal("Bun", { ...Bun, file: (filename: string) => filename, spawn });
  fetchMock.mockResolvedValueOnce(
    new Response(
      "var ytInitialPlayerResponse = " +
        JSON.stringify({
          videoDetails: { videoId, channelId, shortDescription: "A recommendation." },
        }) +
        ";</script>",
    ),
  );
  expect(await readVideoEvidenceDetails(videoId, channelId)).toMatchObject({
    code: "captions_rate_limited",
    sourceKind: "description",
  });
  expect(spawn).toHaveBeenCalledTimes(1);
  const args = spawn.mock.calls[0][0];
  expect(args[args.indexOf("--extractor-retries") + 1]).toBe("0");
  expect(args[args.indexOf("--fragment-retries") + 1]).toBe("0");
  await expect(readVideoEvidenceDetails(videoId, channelId)).rejects.toThrow("paused");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledTimes(1);
});
