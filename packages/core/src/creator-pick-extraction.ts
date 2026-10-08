import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { CreatorVideoPickCheck } from "@sofa/api/schemas";
import {
  beginCreatorVideoCheck,
  updateCreatorVideoCheck,
  getLatestCreatorVideoCheck,
  saveCreatorMovieObservations,
  updateCreatorMovieMatch,
} from "@sofa/db/queries/creator-checks";
import { importVerifiedCreatorPicks } from "@sofa/db/queries/creator-recommendations";
import { searchMovies, getMovieDetails } from "@sofa/tmdb/client";

import { analyzeModelMovies, CreatorModelError } from "./creator-pick-model";
import {
  assertYouTubeRequestAllowed,
  fetchCreatorYouTube,
  getYouTubeRetryAfter,
  pauseYouTubeRequests,
  YouTubeCooldownError,
} from "./creator-youtube";
import { getSetting } from "./settings";

export const PickCheck = CreatorVideoPickCheck;
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
class SourceHttpError extends Error {
  constructor(public readonly status: number) {
    super("Source unavailable");
  }
}
export async function boundedText(url: string, limit: number) {
  const response = await fetchCreatorYouTube(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new SourceHttpError(response.status);
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
const Captions = z.object({
  events: z
    .array(
      z.object({
        tStartMs: z.number().optional(),
        segs: z.array(z.object({ utf8: z.string() })).optional(),
      }),
    )
    .max(50000),
});
function captionText(raw: string) {
  return Captions.parse(JSON.parse(raw))
    .events.filter((event) => event.segs?.length)
    .map(
      (event) =>
        (event.tStartMs === undefined ? "" : `[${Math.floor(event.tStartMs / 1000)}] `) +
        event.segs!.map((segment) => segment.utf8).join(""),
    )
    .filter((line) => line.trim())
    .join("\n");
}
export type VideoEvidence = {
  text: string;
  sourceKind: "description" | "captions";
  code?: "captions_rate_limited" | "captions_unavailable";
  retryAt?: string;
};
export async function readVideoEvidenceDetails(
  videoId: string,
  channelId: string,
): Promise<VideoEvidence> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Invalid video ID");
  const html = await boundedText(`https://www.youtube.com/watch?v=${videoId}`, 5_000_000);
  const match = html.match(/var ytInitialPlayerResponse = (.*?);<\/script>/);
  if (!match) throw new Error("Video metadata unavailable");
  const player = Player.parse(JSON.parse(match[1]));
  if (player.videoDetails.videoId !== videoId || player.videoDetails.channelId !== channelId)
    throw new Error("Video identity mismatch");
  const description = player.videoDetails.shortDescription;
  const partial = (
    code: "captions_rate_limited" | "captions_unavailable",
    retryAt = new Date(Date.now() + 3600_000).toISOString(),
  ): VideoEvidence => ({ text: description, sourceKind: "description", code, retryAt });
  const cooldown = getYouTubeRetryAfter();
  if (cooldown > Date.now())
    return partial("captions_rate_limited", new Date(cooldown).toISOString());
  const track = player.captions?.playerCaptionsTracklistRenderer.captionTracks.find((item) =>
    /^en(?:-|$)/.test(item.languageCode),
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
    try {
      const raw = await boundedText(url.toString(), 2_000_000);
      if (raw) {
        const captions = captionText(raw);
        if (captions) return { text: description + "\n" + captions, sourceKind: "captions" };
      }
    } catch (error) {
      if (error instanceof YouTubeCooldownError) {
        return partial("captions_rate_limited", new Date(error.retryAt).toISOString());
      }
    }
  }
  if (!process.env.CREATOR_CAPTION_TOOL) return partial("captions_unavailable");
  const folder = await mkdtemp(path.join(tmpdir(), "sofa-critic-"));
  try {
    assertYouTubeRequestAllowed();
    const child = Bun.spawn(
      [
        process.env.CREATOR_CAPTION_TOOL,
        "--ignore-config",
        "--quiet",
        "--no-warnings",
        "--skip-download",
        "--no-playlist",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en,en-US,en-GB",
        "--sub-format",
        "json3",
        "--socket-timeout",
        "10",
        "--retries",
        "0",
        "--extractor-retries",
        "0",
        "--fragment-retries",
        "0",
        "-o",
        path.join(folder, "captions"),
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { stdout: "ignore", stderr: Bun.file(path.join(folder, "download.log")) },
    );
    const timer = setTimeout(() => child.kill(), 45_000);
    try {
      const exit = await child.exited;
      if (exit !== 0) {
        const logFile = path.join(folder, "download.log");
        const message = (await stat(logFile)).size <= 64000 ? await readFile(logFile, "utf8") : "";
        if (/HTTP Error 429|Too Many Requests/i.test(message)) {
          return partial("captions_rate_limited", new Date(pauseYouTubeRequests()).toISOString());
        }
        return partial("captions_unavailable");
      }
      const file = (await readdir(folder)).find((name) => name.endsWith(".json3"));
      if (!file) return partial("captions_unavailable");
      const filename = path.join(folder, file);
      if ((await stat(filename)).size > 2_000_000) return partial("captions_unavailable");
      const captions = captionText(await readFile(filename, "utf8"));
      return captions
        ? { text: description + "\n" + captions, sourceKind: "captions" }
        : partial("captions_unavailable");
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof YouTubeCooldownError)
      return partial("captions_rate_limited", new Date(error.retryAt).toISOString());
    return partial("captions_unavailable");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
export async function readVideoEvidence(videoId: string, channelId: string) {
  return (await readVideoEvidenceDetails(videoId, channelId)).text;
}
export function getVideoPickCheck(creatorId: string, videoId: string) {
  const latest = getLatestCreatorVideoCheck(creatorId, videoId);
  if (latest)
    return PickCheck.parse({
      state: latest.state,
      picksAdded: latest.picksAdded,
      reason: latest.reason ?? "",
      code: latest.errorCode ?? undefined,
      retryAt: latest.retryAt?.toISOString() ?? null,
      moviesDiscussed: latest.moviesDiscussed,
      moviesRecommended: latest.moviesRecommended,
      sourceKind: latest.sourceKind,
      sourceCharacters: latest.sourceCharacters,
      analyzedCharacters: latest.analyzedCharacters,
    });
  try {
    return PickCheck.parse(
      JSON.parse(getSetting(`creator:${creatorId}:video:${videoId}:picks`) ?? "null"),
    );
  } catch {
    return null;
  }
}
export function shouldCheckCreatorVideo(creatorId: string, videoId: string) {
  const latest = getLatestCreatorVideoCheck(creatorId, videoId);
  if (!latest) return true; // Legacy summaries have no audit trail: perform one real audited check.
  if (latest.retryAt) return latest.retryAt.getTime() <= Date.now();
  return latest.state === "failed";
}
const pending = new Map<string, Promise<z.infer<typeof PickCheck>>>();
export async function processCreatorVideo(
  creatorId: string,
  channelId: string,
  video: { videoId: string; videoTitle: string; publishedAt: string },
  channelCheckId?: string,
) {
  const key = `creator:${creatorId}:video:${video.videoId}:picks`;
  const existing = getVideoPickCheck(creatorId, video.videoId);
  if (existing && !shouldCheckCreatorVideo(creatorId, video.videoId))
    return { ...existing, picksAdded: 0, attempted: false };
  const shared = pending.get(key);
  if (shared) return { ...(await shared), picksAdded: 0, attempted: false };
  const request = (async () => {
    const checkId = beginCreatorVideoCheck({
      creatorId,
      channelCheckId,
      ...video,
      model: process.env.CREATOR_PICK_MODEL ?? "explicit-rules",
    });
    let stage: "evidence" | "model" | "matching" | "complete" = "evidence";
    let result: z.infer<typeof PickCheck>;
    try {
      const evidence = await readVideoEvidenceDetails(video.videoId, channelId);
      stage = "model";
      updateCreatorVideoCheck(checkId, {
        stage,
        sourceKind: evidence.sourceKind,
        sourceCharacters: evidence.text.length,
        analyzedCharacters: 0,
        errorCode: evidence.code,
      });
      const modelObservations = await analyzeModelMovies(evidence.text, video.videoTitle);
      const observations =
        modelObservations ??
        extractExplicitPicks(evidence.text).map((movie) =>
          Object.assign({}, movie, {
            assessment: "recommended" as const,
            evidence: evidence.text.slice(0, 2000),
          }),
        );
      const rows = saveCreatorMovieObservations(
        checkId,
        observations.map((movie) => ({
          movieTitle: movie.title,
          releaseYear: movie.year,
          assessment: movie.assessment,
          evidence: movie.evidence.slice(0, 4000),
          startSeconds: movie.startSeconds,
          matchStatus: "pending",
        })),
      );
      stage = "matching";
      updateCreatorVideoCheck(checkId, {
        stage,
        analyzedCharacters:
          modelObservations === null ? evidence.text.length : Math.min(evidence.text.length, 24000),
        moviesDiscussed: observations.length,
        moviesRecommended: observations.filter((movie) => movie.assessment === "recommended")
          .length,
      });
      const picks: {
        tmdbId: number;
        movieTitle: string;
        startSeconds: number | null;
        evidence: string;
      }[] = [];
      let ambiguous = false,
        lookupFailed = false;
      for (const [index, candidate] of observations.entries()) {
        try {
          const movies = await searchMovies(candidate.title);
          const matches =
            movies.results?.filter(
              (movie) =>
                (movie.title === candidate.title || movie.original_title === candidate.title) &&
                (candidate.year === null || movie.release_date?.startsWith(String(candidate.year))),
            ) ?? [];
          if ((movies.total_pages ?? 1) > 1 || matches.length !== 1 || !matches[0].id) {
            updateCreatorMovieMatch(rows[index].id, "ambiguous", null);
            if (candidate.assessment === "recommended") ambiguous = true;
            continue;
          }
          const details = await getMovieDetails(matches[0].id);
          if (
            details.id !== matches[0].id ||
            (candidate.year !== null &&
              !details.release_date?.startsWith(String(candidate.year))) ||
            (details.title !== candidate.title && details.original_title !== candidate.title)
          ) {
            updateCreatorMovieMatch(rows[index].id, "ambiguous", null);
            if (candidate.assessment === "recommended") ambiguous = true;
            continue;
          }
          const imdbId =
            typeof details.imdb_id === "string" && /^tt\d{7,10}$/.test(details.imdb_id)
              ? details.imdb_id
              : null;
          updateCreatorMovieMatch(rows[index].id, "matched", details.id, imdbId);
          if (candidate.assessment === "recommended")
            picks.push({
              tmdbId: details.id,
              movieTitle: details.title!,
              startSeconds: candidate.startSeconds,
              evidence: candidate.evidence,
            });
        } catch {
          lookupFailed = true;
          updateCreatorMovieMatch(rows[index].id, "unavailable", null);
        }
      }
      const picksAdded = picks.length ? importVerifiedCreatorPicks(creatorId, video, picks) : 0;
      result = {
        state: lookupFailed ? "failed" : ambiguous || !picks.length ? "review" : "added",
        picksAdded,
        reason: lookupFailed
          ? "Movie lookup unavailable"
          : ambiguous
            ? "Movie identity needs review"
            : !picks.length
              ? "No verified endorsement; discussion records preserved"
              : "Verified endorsements matched to TMDB",
        code: lookupFailed ? "movie_lookup_failed" : evidence.code,
        retryAt: lookupFailed
          ? new Date(Date.now() + 3600_000).toISOString()
          : (evidence.retryAt ?? null),
        moviesDiscussed: observations.length,
        moviesRecommended: observations.filter((movie) => movie.assessment === "recommended")
          .length,
        sourceKind: evidence.sourceKind,
      };
      stage = "complete";
    } catch (error) {
      const code =
        error instanceof YouTubeCooldownError
          ? "youtube_rate_limited"
          : error instanceof CreatorModelError
            ? error.code
            : stage === "evidence"
              ? "video_evidence_unavailable"
              : "movie_lookup_failed";
      result = {
        state: "failed",
        picksAdded: 0,
        reason: "Video check could not finish",
        code,
        retryAt: new Date(
          error instanceof YouTubeCooldownError ? error.retryAt : Date.now() + 3600_000,
        ).toISOString(),
      };
    }
    updateCreatorVideoCheck(checkId, {
      state: result.state,
      stage,
      picksAdded: result.picksAdded,
      errorCode: result.code,
      reason: result.reason,
      retryAt: result.retryAt ? new Date(result.retryAt) : null,
      finishedAt: new Date(),
    });
    return result;
  })();
  pending.set(key, request);
  try {
    return { ...(await request), attempted: true };
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
