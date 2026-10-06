import { Trans, useLingui } from "@lingui/react/macro";
import { useAtom, useAtomValue } from "jotai";
import type { z } from "zod";

import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { providerFirefoxAtom } from "@/lib/atoms/provider-browser";
import { providerFirefoxUrl } from "@/lib/provider-link";
import type { UsAvailabilitySummary } from "@sofa/api/schemas";
import type { AvailabilityOffer } from "@sofa/api/schemas";
import { formatRelativeTime } from "@sofa/i18n/format";

const MAX_VISIBLE = 4;

// offerLabels moved into component for LingUI

function ProviderBadge({
  name,
  logoPath,
  watchUrl,
  linkType,
}: {
  name: string;
  logoPath: string | null;
  watchUrl: string | null;
  linkType?: AvailabilityOffer["linkType"];
}) {
  const { t } = useLingui();
  const action =
    linkType === "title"
      ? t`Open ${name} title page`
      : linkType === "search"
        ? t`Search ${name}`
        : t`Visit ${name}`;
  const firefox = useAtomValue(providerFirefoxAtom);
  const href = watchUrl && firefox ? providerFirefoxUrl(watchUrl) : watchUrl;
  return (
    <Tooltip>
      <TooltipTrigger
        {...(watchUrl
          ? {
              render: (
                <a
                  href={href ?? undefined}
                  target={firefox ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  aria-label={action}
                />
              ),
            }
          : {})}
        className={`border-border/30 bg-card flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border motion-safe:transition-transform motion-safe:hover:scale-105${watchUrl ? "" : "cursor-default"}`}
      >
        {logoPath ? (
          <img
            src={logoPath}
            alt={name}
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-muted-foreground text-[8px] font-medium">{name.slice(0, 2)}</span>
        )}
      </TooltipTrigger>
      <TooltipContent className="bg-popover text-popover-foreground px-2 py-1 text-[10px] font-medium shadow-md [&>:last-child]:hidden">
        {action}
      </TooltipContent>
    </Tooltip>
  );
}

function OverflowProviderIcon({ offer }: { offer: AvailabilityOffer }) {
  return (
    <div className="border-border/20 bg-card flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border">
      {offer.logoPath ? (
        <img
          src={offer.logoPath}
          alt={offer.providerName}
          width={28}
          height={28}
          loading="lazy"
          decoding="async"
          className="h-7 w-7 object-cover"
        />
      ) : (
        <span className="text-muted-foreground text-[7px] font-medium">
          {offer.providerName.slice(0, 2)}
        </span>
      )}
    </div>
  );
}

function OverflowBadge({ offers }: { offers: AvailabilityOffer[] }) {
  const firefox = useAtomValue(providerFirefoxAtom);
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={0}
        closeDelay={300}
        className="border-border/30 bg-card text-muted-foreground flex h-10 w-10 cursor-default items-center justify-center rounded-lg border text-xs font-semibold motion-safe:transition-transform motion-safe:hover:scale-105"
      >
        +{offers.length}
      </PopoverTrigger>
      <PopoverContent className="divide-border/30 flex w-auto max-w-64 flex-col gap-0 divide-y p-0.5">
        {offers.map((offer) =>
          offer.watchUrl ? (
            <a
              key={offer.platformId}
              href={firefox ? (providerFirefoxUrl(offer.watchUrl) ?? undefined) : offer.watchUrl}
              target={firefox ? undefined : "_blank"}
              rel="noopener noreferrer"
              className="hover:bg-muted/50 flex items-center gap-2.5 px-2 py-1.5"
            >
              <OverflowProviderIcon offer={offer} />
              <span className="text-popover-foreground truncate text-xs">{offer.providerName}</span>
            </a>
          ) : (
            <div key={offer.platformId} className="flex items-center gap-2.5 px-2 py-1.5">
              <OverflowProviderIcon offer={offer} />
              <span className="text-popover-foreground truncate text-xs">{offer.providerName}</span>
            </div>
          ),
        )}
      </PopoverContent>
    </Popover>
  );
}

function OffersByType({
  offers,
  offerLabels,
}: {
  offers: AvailabilityOffer[];
  offerLabels: Record<string, string>;
}) {
  const byType: Record<string, AvailabilityOffer[]> = {};
  for (const offer of offers.flatMap((entry) =>
    entry.accessTypes?.length
      ? entry.accessTypes.map((offerType) => ({ ...entry, offerType }))
      : [entry],
  )) {
    if (!byType[offer.offerType]) byType[offer.offerType] = [];
    byType[offer.offerType].push(offer);
  }

  return (
    <div className="flex flex-wrap gap-4">
      {Object.entries(byType).map(([type, typeOffers]) => {
        const visible = typeOffers.slice(0, MAX_VISIBLE);
        const overflow = typeOffers.slice(MAX_VISIBLE);

        return (
          <div key={type} className="space-y-1.5">
            <span className="text-muted-foreground/60 text-[10px] font-medium tracking-wider uppercase">
              {offerLabels[type] ?? type}
            </span>
            <div className="flex gap-1.5">
              {visible.map((offer) => (
                <ProviderBadge
                  key={offer.platformId}
                  name={offer.providerName}
                  logoPath={offer.logoPath}
                  watchUrl={offer.watchUrl}
                  linkType={offer.linkType}
                />
              ))}
              {overflow.length > 0 && <OverflowBadge offers={overflow} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AvailabilityDetails({ availability }: { availability: AvailabilityOffer[] }) {
  const { t } = useLingui();
  const offerLabels: Record<string, string> = {
    stream: t`Stream`,
    purchase: t`Buy or Rent`,
    free: t`Free`,
    ads: t`With ads`,
    flatrate: t`Subscription`,
    rent: t`Rent`,
    buy: t`Buy`,
  };

  if (availability.length === 0) return null;

  const userOffers = availability.filter((o) => o.isUserSubscribed);
  const otherOffers = availability.filter((o) => !o.isUserSubscribed);

  // If user has matching subscriptions, show split view
  if (userOffers.length > 0) {
    return (
      <div className="space-y-4 pt-1">
        <div className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            <Trans>On your services</Trans>
          </h2>
          <OffersByType offers={userOffers} offerLabels={offerLabels} />
        </div>

        {otherOffers.length > 0 && (
          <div className="border-border/30 space-y-2 border-t pt-3">
            <h2 className="text-muted-foreground/60 text-[10px] font-medium tracking-wider uppercase">
              <Trans>Also available on</Trans>
            </h2>
            <div className="opacity-60">
              <OffersByType offers={otherOffers} offerLabels={offerLabels} />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Default: single "Where to Watch" section
  return (
    <div className="space-y-2 pt-1">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        <Trans>Where to Watch</Trans>
      </h2>
      <OffersByType offers={availability} offerLabels={offerLabels} />
    </div>
  );
}

export function TitleAvailability({
  availability,
  usAvailability,
}: {
  availability: AvailabilityOffer[];
  usAvailability?: z.infer<typeof UsAvailabilitySummary>;
}) {
  const { t } = useLingui();
  const [firefox, setFirefox] = useAtom(providerFirefoxAtom);
  const checked = usAvailability ? formatRelativeTime(usAvailability.checkedAt) : null;
  return (
    <div className="space-y-3">
      <AvailabilityDetails availability={availability} />
      {availability.length === 0 && (
        <p className="text-muted-foreground text-xs">
          {usAvailability
            ? t`No US offers are currently listed for this title.`
            : t`Availability could not be refreshed. Try again later.`}
        </p>
      )}
      {checked && (
        <p className="text-muted-foreground text-xs">{t`US availability checked ${checked}`}</p>
      )}
      {availability.length > 0 && (
        <p className="text-muted-foreground text-xs">{t`Provider icons open a title page when available, otherwise a provider search or home page. Availability and account requirements can change.`}</p>
      )}
      {usAvailability?.watchPageUrl && (
        <a
          className="text-primary text-xs hover:underline"
          href={usAvailability.watchPageUrl}
          target="_blank"
          rel="noopener noreferrer"
        >{t`Find title-specific US watch links on TMDB / JustWatch`}</a>
      )}
      {availability.length > 0 && (
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={firefox} onCheckedChange={setFirefox} />
          {t`Open provider links in Firefox`}
        </label>
      )}
    </div>
  );
}
