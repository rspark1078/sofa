import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { z } from "zod";

import type { CreatorVideoPickCheck } from "@sofa/api/schemas";
import { formatDate } from "@sofa/i18n/format";

type Check = z.infer<typeof CreatorVideoPickCheck>;

export function CreatorCheckStatus({ check }: { check: Check | null }) {
  const { t } = useLingui();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!check?.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [check?.retryAt]);
  if (!check)
    return (
      <p className="text-muted-foreground text-xs">
        <Trans>Awaiting recommendation check</Trans>
      </p>
    );
  let diagnostic: string | null = null;
  switch (check.code) {
    case "youtube_rate_limited":
      diagnostic = t`YouTube requests are temporarily paused after a rate limit. Retry when the cooldown ends.`;
      break;
    case "captions_rate_limited":
      diagnostic = t`YouTube temporarily limited caption requests. Spoken recommendations may be missing.`;
      break;
    case "captions_unavailable":
      diagnostic = t`Captions were unavailable. Spoken recommendations may be missing.`;
      break;
    case "video_evidence_unavailable":
      diagnostic = t`The video's text could not be retrieved.`;
      break;
    case "model_unavailable":
      diagnostic = t`The local recommendation model was unavailable.`;
      break;
    case "model_truncated":
      diagnostic = t`The model response was incomplete. Recommendations could not be verified.`;
      break;
    case "model_invalid_output":
      diagnostic = t`The model response could not be validated. Recommendations could not be verified.`;
      break;
    case "movie_lookup_failed":
      diagnostic = t`Movie identity lookup was unavailable. Some recommendations remain unverified.`;
      break;
    case "interrupted":
      diagnostic = t`The check was interrupted by a server restart.`;
      break;
    default:
      if (check.code) diagnostic = t`Check details are unavailable.`;
  }
  const { moviesDiscussed, moviesRecommended, picksAdded } = check;
  const retryAt = check.retryAt ? new Date(check.retryAt) : null;
  const retryLabel = retryAt ? formatDate(retryAt, { hour: "numeric", minute: "2-digit" }) : null;
  const partialText =
    check.sourceCharacters !== undefined &&
    check.analyzedCharacters !== undefined &&
    check.analyzedCharacters > 0 &&
    check.sourceCharacters > check.analyzedCharacters;
  return (
    <div className="text-muted-foreground space-y-1 text-xs">
      <p>
        {check.state === "added"
          ? t`Verified recommendations saved`
          : check.state === "failed"
            ? t`Verification unavailable; retry required`
            : t`Recommendation review required`}
      </p>
      {diagnostic && <p>{diagnostic}</p>}
      {check.sourceKind === "description" && (
        <p>
          <Trans>Checked the description only; spoken content may be missing.</Trans>
        </p>
      )}
      {check.sourceKind === "captions" && (
        <p>
          <Trans>Checked available captions and description.</Trans>
        </p>
      )}
      {partialText && (
        <p>
          <Trans>Part of the available text was omitted from this check.</Trans>
        </p>
      )}
      {(moviesDiscussed !== undefined || moviesRecommended !== undefined) && (
        <p>
          {moviesDiscussed !== undefined && t`Movies discussed: ${moviesDiscussed}`}
          {moviesDiscussed !== undefined && moviesRecommended !== undefined && " · "}
          {moviesRecommended !== undefined && t`Endorsements detected: ${moviesRecommended}`}
        </p>
      )}
      <p>
        <Trans>Verified picks added: {picksAdded}</Trans>
      </p>
      {retryAt && (
        <p>
          {retryAt.getTime() > now
            ? t`Eligible for retry after ${retryLabel}.`
            : t`Retry is eligible on the next refresh.`}
        </p>
      )}
    </div>
  );
}
