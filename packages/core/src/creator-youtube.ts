import { getSetting, setSetting } from "./settings";

const KEY = "creatorYouTubeRetryAfter";
const DEFAULT_DELAY = 3600_000;
export class YouTubeCooldownError extends Error {
  constructor(
    readonly retryAt: number,
    readonly blocked = true,
  ) {
    super("YouTube requests paused");
  }
}
export function getYouTubeRetryAfter() {
  return Math.max(
    0,
    ...[KEY, "creatorCaptionsRetryAfter"].map((key) => {
      const value = Number(getSetting(key));
      return Number.isFinite(value) ? value : 0;
    }),
  );
}
export function assertYouTubeRequestAllowed() {
  const retryAt = getYouTubeRetryAfter();
  if (retryAt > Date.now()) throw new YouTubeCooldownError(retryAt);
}
export function pauseYouTubeRequests(retryAfter: string | null = null) {
  const now = Date.now();
  const seconds = retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : NaN;
  const requested = Number.isFinite(seconds)
    ? seconds * 1000
    : retryAfter
      ? Date.parse(retryAfter) - now
      : NaN;
  const delay =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, 24 * 3600_000)
      : DEFAULT_DELAY;
  const retryAt = Math.max(getYouTubeRetryAfter(), now + delay);
  setSetting(KEY, String(retryAt));
  return retryAt;
}
export async function fetchCreatorYouTube(url: string, init: RequestInit = {}) {
  assertYouTubeRequestAllowed();
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.hostname !== "www.youtube.com" ||
    target.username ||
    target.password
  )
    throw new Error("Invalid YouTube source");
  const response = await fetch(url, { ...init, redirect: "error" });
  if (response.status === 429) {
    const retryAt = pauseYouTubeRequests(response.headers.get("retry-after"));
    await response.body?.cancel().catch(() => undefined);
    throw new YouTubeCooldownError(retryAt, false);
  }
  return response;
}
