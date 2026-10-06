import { useLingui } from "@lingui/react/macro";
import type { z } from "zod";

import type { CreatorCredit } from "@sofa/api/schemas";
import { formatDate } from "@sofa/i18n/format";

export function CreatorCredits({ credits }: { credits?: z.infer<typeof CreatorCredit>[] }) {
  const { t } = useLingui();
  if (!credits?.length) return null;
  return (
    <div className="space-y-2 text-xs">
      {credits.map((credit) => (
        <div key={credit.id + credit.videoUrl} className="space-y-1">
          <p>
            <span className="text-muted-foreground">{t`Picked by`} </span>
            <a
              className="text-primary hover:underline"
              href={credit.channelUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {credit.name}
            </a>
          </p>
          <p className="text-muted-foreground">
            {credit.origin === "automated"
              ? t`Automatically identified recommendation`
              : t`Curated recommendation`}
          </p>
          <a
            className="text-primary block hover:underline"
            href={credit.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={credit.videoTitle}
          >{t`Watch the recommendation`}</a>
          <p className="text-muted-foreground">
            {credit.videoTitle} · {formatDate(new Date(credit.publishedAt + "T12:00:00Z"))}
          </p>
        </div>
      ))}
    </div>
  );
}
