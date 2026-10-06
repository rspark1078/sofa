import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { importVerifiedCreatorPicks } from "@sofa/db/queries/creator-recommendations";
import { searchMovies, getMovieDetails } from "@sofa/tmdb/client";

import { extractModelPicks } from "./creator-pick-model";
import { getSetting, setSetting } from "./settings";

export const PickCheck = z.object({
  state: z.enum(["added", "review", "failed"]),
  picksAdded: z.number(),
  reason: z.string(),
});
type Candidate = { title: string; year: number | null; startSeconds: number | null };
// Only explicit, quoted title/year endorsements qualify. Review coverage is not endorsement.
export function extractExplicitPicks(text: string): Candidate[] {
  const result: Candidate[] = [];
  for (const match of text.matchAll(
    /(?:^|[.!?]\s+|\n)(?:I recommend|We recommend|My pick is|Our pick is|You should watch)\s+["“]([^"”\n]{1,150})["”]\s*\((19\d{2}|20\d{2})\)/gi,
  )) {
    result.push({ title: match[1].trim(), year: Number(match[2]), startSeconds: null });
  }
  return [...new Map(result.map((pick) => [pick.title + pick.year, pick])).values()].slice(0, 10);
}
export async function boundedText(url: string, limit: number) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error("Source unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty source");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Source too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
const Player = z.object({
  videoDetails: z.object({
    videoId: z.string(),
    channelId: z.string(),
    shortDescription: z.string().max(100000),
  }),
  captions: z
    .object({
      playerCaptionsTracklistRenderer: z.object({
        captionTracks: z.array(z.object({ languageCode: z.string(), baseUrl: z.string() })),
      }),
    })
    .optional(),
});
export async function readVideoEvidence(videoId: string, channelId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Invalid video ID");
  const html = await boundedText(`https://www.youtube.com/watch?v=${videoId}`, 5_000_000);
  const match = html.match(/var ytInitialPlayerResponse = (.*?);<\/script>/);
  if (!match) throw new Error("Video metadata unavailable");
  const player = Player.parse(JSON.parse(match[1]));
  if (player.videoDetails.videoId !== videoId || player.videoDetails.channelId !== channelId)
    throw new Error("Video identity mismatch");
  let text = player.videoDetails.shortDescription;
  const track = player.captions?.playerCaptionsTracklistRenderer.captionTracks.find(
    (item) => item.languageCode === "en",
  );
  if (track) {
    const url = new URL(track.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.youtube.com" ||
      url.pathname !== "/api/timedtext" ||
      url.username ||
      url.password ||
      url.searchParams.get("v") !== videoId
    )
      throw new Error("Invalid caption source");
    url.searchParams.set("fmt", "json3");
    const raw = await boundedText(url.toString(), 2_000_000);
    if (raw) {
      const captions = z
        .object({
          events: z
            .array(z.object({ segs: z.array(z.object({ utf8: z.string() })).optional() }))
            .max(50000),
        })
        .parse(JSON.parse(raw ?? "null"));
      text +=
        "\n" +
        captions.events
          .map((event) => event.segs?.map((segment) => segment.utf8).join("") ?? "")
          .join(" ");
    }
  }
  if (track && text === player.videoDetails.shortDescription && process.env.CREATOR_CAPTION_TOOL) {
    const folder = await mkdtemp(path.join(tmpdir(), "sofa-critic-"));
    try {
      const child = Bun.spawn(
        [
          process.env.CREATOR_CAPTION_TOOL,
          "--ignore-config",
          "--skip-download",
          "--no-playlist",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs",
          "en",
          "--sub-format",
          "json3",
          "--socket-timeout",
          "10",
          "--retries",
          "0",
          "-o",
          path.join(folder, "captions"),
          `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      const timer = setTimeout(() => child.kill(), 45_000);
      try {
        if ((await child.exited) !== 0) throw new Error("Captions unavailable");
        const file = (await readdir(folder)).find((name) => name.endsWith(".json3"));
        if (file) {
          const filename = path.join(folder, file);
          if ((await stat(filename)).size > 2_000_000) throw new Error("Captions too large");
          const captions = z
            .object({
              events: z
                .array(
                  z.object({
                    tStartMs: z.number().optional(),
                    segs: z.array(z.object({ utf8: z.string() })).optional(),
                  }),
                )
                .max(50000),
            })
            .parse(JSON.parse(await readFile(filename, "utf8")));
          text +=
            "\n" +
            captions.events
              .filter((event) => event.segs)
              .map(
                (event) =>
                  `[${Math.floor((event.tStartMs ?? 0) / 1000)}] ` +
                  event.segs!.map((segment) => segment.utf8).join(""),
              )
              .join("\n");
        }
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
  return text;
}
export function getVideoPickCheck(creatorId: string, videoId: string) {
  const raw = getSetting(`creator:${creatorId}:video:${videoId}:picks`);
  try {
    return PickCheck.parse(JSON.parse(raw ?? "null"));
  } catch {
    return null;
  }
}
const pending = new Map<string, Promise<z.infer<typeof PickCheck>>>();
export async function processCreatorVideo(
  creatorId: string,
  channelId: string,
  video: { videoId: string; videoTitle: string; publishedAt: string },
) {
  const key = `creator:${creatorId}:video:${video.videoId}:picks`;
  const existing = getVideoPickCheck(creatorId, video.videoId);
  if (existing && existing.state !== "failed") return { ...existing, picksAdded: 0 };
  const shared = pending.get(key);
  if (shared) {
    const result = await shared;
    return { ...result, picksAdded: 0 };
  }
  const request = (async () => {
    let result: z.infer<typeof PickCheck>;
    try {
      const evidence = await readVideoEvidence(video.videoId, channelId);
      const candidates =
        (await extractModelPicks(evidence, video.videoTitle)) ?? extractExplicitPicks(evidence);
      const picks: {
        tmdbId: number;
        movieTitle: string;
        startSeconds: number | null;
        evidence?: string;
      }[] = [];
      let ambiguous = false;
      for (const candidate of candidates) {
        const movies = await searchMovies(candidate.title);
        const matches =
          movies.results?.filter(
            (movie) =>
              (movie.title === candidate.title || movie.original_title === candidate.title) &&
              (candidate.year === null || movie.release_date?.startsWith(String(candidate.year))),
          ) ?? [];
        if ((movies.total_pages ?? 1) > 1 || matches.length !== 1 || !matches[0].id) {
          ambiguous = true;
          continue;
        }
        const details = await getMovieDetails(matches[0].id);
        if (
          details.id !== matches[0].id ||
          (candidate.year !== null && !details.release_date?.startsWith(String(candidate.year))) ||
          (details.title !== candidate.title && details.original_title !== candidate.title)
        ) {
          ambiguous = true;
          continue;
        }
        picks.push({
          tmdbId: details.id,
          movieTitle: details.title!,
          startSeconds: candidate.startSeconds,
          evidence: "evidence" in candidate ? String(candidate.evidence) : undefined,
        });
      }
      const picksAdded = picks.length ? importVerifiedCreatorPicks(creatorId, video, picks) : 0;
      result = {
        state: ambiguous || !picks.length ? "review" : "added",
        picksAdded,
        reason: ambiguous
          ? "Movie identity needs review"
          : !picks.length
            ? "No verified explicit endorsement found; review required"
            : "Explicit endorsements matched to TMDB",
      };
    } catch {
      result = {
        state: "failed",
        picksAdded: 0,
        reason: "Video or movie verification unavailable; retry required",
      };
    }
    setSetting(key, JSON.stringify(result));
    return result;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

export async function readCreatorUploads(channelId: string) {
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) throw new Error("Invalid channel");
  const page = await boundedText(`https://www.youtube.com/channel/${channelId}/videos`, 5_000_000);
  const match = page.match(/var ytInitialData = (.*?);<\/script>/);
  if (!match) throw new Error("Channel listing unavailable");
  const raw: unknown = JSON.parse(match[1]);
  const identity = z
    .object({
      metadata: z.object({ channelMetadataRenderer: z.object({ externalId: z.string() }) }),
    })
    .parse(raw);
  if (identity.metadata.channelMetadataRenderer.externalId !== channelId)
    throw new Error("Channel listing identity mismatch");
  const ids = new Set<string>();
  function visit(node: unknown, depth = 0) {
    if (depth > 40 || ids.size >= 3 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const object = node as Record<string, unknown>;
    const video = z
      .object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) })
      .safeParse(object.videoRenderer);
    if (video.success) ids.add(video.data.videoId);
    const lockup = z
      .object({
        contentId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
        contentType: z.literal("LOCKUP_CONTENT_TYPE_VIDEO"),
      })
      .safeParse(object.lockupViewModel);
    if (lockup.success) ids.add(lockup.data.contentId);
    for (const value of Object.values(object)) visit(value, depth + 1);
  }
  visit(raw);
  if (!ids.size) throw new Error("No verifiable channel videos");
  const entries = [];
  for (const videoId of ids) {
    const html = await boundedText(`https://www.youtube.com/watch?v=${videoId}`, 5_000_000);
    const playerMatch = html.match(/var ytInitialPlayerResponse = (.*?);<\/script>/);
    if (!playerMatch) throw new Error("Video metadata unavailable");
    const player = z
      .object({
        videoDetails: z.object({
          videoId: z.string(),
          channelId: z.string(),
          title: z.string().min(1).max(1000),
        }),
        microformat: z.object({
          playerMicroformatRenderer: z.object({
            publishDate: z.string().datetime({ offset: true }),
          }),
        }),
      })
      .parse(JSON.parse(playerMatch[1]));
    if (player.videoDetails.channelId !== channelId || player.videoDetails.videoId !== videoId)
      throw new Error("Channel video identity mismatch");
    entries.push({
      videoId,
      videoTitle: player.videoDetails.title,
      publishedAt: new Date(player.microformat.playerMicroformatRenderer.publishDate).toISOString(),
    });
  }
  return entries;
}
