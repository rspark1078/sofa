import { useLingui } from "@lingui/react/macro";
import type { z } from "zod";

import type { UsAvailabilitySummary } from "@sofa/api/schemas";

export function TitleDiscoveryContext({
  availability,
  sources,
}: {
  availability?: z.infer<typeof UsAvailabilitySummary>;
  sources?: string[];
}) {
  const { t } = useLingui();
  const labels: Record<string, string> = {
    free: t`Free`,
    ads: t`With ads`,
    flatrate: t`Subscription`,
    rent: t`Rent`,
    buy: t`Buy`,
  };
  const types = [...new Set(availability?.offers.map((offer) => offer.offerType) ?? [])];
  const basedOn = sources?.join(", ");
  return (
    <div className="mt-2 space-y-1 text-xs">
      {availability && (
        <div
          className="flex flex-wrap gap-1"
          title={availability.offers
            .map((offer) => offer.providerName)
            .filter((name, index, all) => all.indexOf(name) === index)
            .join(", ")}
        >
          <span className="text-muted-foreground">{t`US`}</span>
          {types.length > 0 ? (
            types.map((type) => (
              <span className="bg-muted rounded px-1.5 py-0.5" key={type}>
                {labels[type]}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">{t`No US offers listed`}</span>
          )}
        </div>
      )}
      {basedOn && <p className="text-muted-foreground">{t`Based on ${basedOn}`}</p>}
    </div>
  );
}
