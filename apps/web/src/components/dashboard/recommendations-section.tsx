import { useLingui } from "@lingui/react/macro";
import { IconThumbUp } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { orpc } from "@/lib/orpc/client";
import { RecommendationSource } from "@sofa/api/schemas";

import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

export function RecommendationsSection() {
  const [source, setSource] = useState<z.infer<typeof RecommendationSource>>("all");
  const [accessType, setAccessType] = useState<"all" | "free" | "paid">("all");
  const {
    data: criticSettings,
    isPending: settingsPending,
    isError: settingsError,
    refetch: refetchSettings,
  } = useQuery(orpc.account.criticPreferences.queryOptions());
  const selectedCreatorIds = criticSettings?.preferences.creatorIds;
  const selectedCreators =
    criticSettings?.creators.filter(
      (creator) => selectedCreatorIds == null || selectedCreatorIds.includes(creator.id),
    ) ?? [];
  const effectiveSource =
    source !== "all" &&
    source !== "personal" &&
    !selectedCreators.some((creator) => creator.id === source)
      ? "all"
      : source;
  const { data, isPending, isPlaceholderData, isError, refetch } = useQuery({
    ...orpc.discover.recommendations.queryOptions({
      input: { accessType, source: effectiveSource },
    }),
    enabled: !!criticSettings,
    placeholderData: keepPreviousData,
  });

  const { t } = useLingui();

  const items = data?.items ?? [];

  return (
    <FeedSection
      title={t`Recommended for You`}
      icon={<IconThumbUp className="text-primary size-5" />}
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={effectiveSource}
            onValueChange={(value) => {
              const parsed = RecommendationSource.safeParse(value);
              if (parsed.success) setSource(parsed.data);
            }}
          >
            <SelectTrigger size="sm" aria-label={t`Recommendation source`}>
              <SelectValue>
                {effectiveSource === "all"
                  ? t`All sources`
                  : effectiveSource === "personal"
                    ? t`Your watch history`
                    : (selectedCreators.find((creator) => creator.id === effectiveSource)?.name ??
                      source)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t`All sources`}</SelectItem>
              <SelectItem value="personal">{t`Your watch history`}</SelectItem>
              {selectedCreators.map((creator) => (
                <SelectItem key={creator.id} value={creator.id}>
                  {creator.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            value={[accessType]}
            onValueChange={(values) => {
              const value = values[0];
              if (value === "all" || value === "free" || value === "paid") setAccessType(value);
            }}
            aria-label={t`Recommendation availability`}
          >
            <ToggleGroupItem value="all">{t`All`}</ToggleGroupItem>
            <ToggleGroupItem value="free">{t`Free`}</ToggleGroupItem>
            <ToggleGroupItem value="paid">{t`Paid`}</ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="outline"
            size="sm"
            disabled={!criticSettings || isPending || isPlaceholderData}
            onClick={() => void refetch()}
          >{t`Refresh recommendations`}</Button>
        </div>
      }
    >
      <p className="text-muted-foreground text-sm">{t`Creator picks are curated from linked videos. US availability is checked separately; picks already in your library are hidden.`}</p>
      {data?.creators && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t`Creator channels`}>
          {selectedCreators.map((creator) => (
            <a
              key={creator.id}
              href={creator.channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {creator.name}
            </a>
          ))}
        </div>
      )}
      {settingsPending || (!settingsError && (isPending || isPlaceholderData)) ? (
        <TitleGridSectionSkeleton />
      ) : isError || settingsError ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">{t`Unable to refresh recommendation availability.`}</p>
          <Button
            variant="outline"
            onClick={() => void (settingsError ? refetchSettings() : refetch())}
          >{t`Retry`}</Button>
        </div>
      ) : items.length > 0 ? (
        <TitleGrid items={items} wide />
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            {accessType === "all"
              ? effectiveSource === "personal"
                ? t`Watch or rate titles to build your recommendations.`
                : t`No unseen creator picks remain. Try another recommendation source.`
              : t`No recommendations match this US availability filter.`}
          </p>
          {accessType !== "all" && (
            <Button
              variant="outline"
              onClick={() => setAccessType("all")}
            >{t`Show all recommendations`}</Button>
          )}
          <Button
            variant="ghost"
            render={<Link to="/explore" />}
          >{t`Explore titles to watch or rate`}</Button>
        </div>
      )}
    </FeedSection>
  );
}
