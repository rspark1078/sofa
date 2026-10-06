import { useLingui } from "@lingui/react/macro";
import { IconSelector, IconFilterOff, IconLoader, IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import { FeedSection } from "@/components/dashboard/feed-section";
import { TitleGrid } from "@/components/dashboard/title-grid";
import type { DiscoverSearch } from "@/components/explore/discover-search";
import { DiscoveryPresets } from "@/components/explore/discovery-presets";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectTriggerClassName,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { orpc } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

const DECADE_PRESETS = [
  { label: "2020s", min: 2020, max: 2029 },
  { label: "2010s", min: 2010, max: 2019 },
  { label: "2000s", min: 2000, max: 2009 },
  { label: "1990s", min: 1990, max: 1999 },
  { label: "1980s", min: 1980, max: 1989 },
  { label: "1970s", min: 1970, max: 1979 },
  { label: "Pre-1970", min: 1900, max: 1969 },
] as const;

const RATING_PRESETS = [
  { label: "7+", value: 7 },
  { label: "6+", value: 6 },
  { label: "5+", value: 5 },
] as const;

const SORT_OPTIONS = [
  { value: "popularity.desc", labelKey: "Most popular" },
  { value: "vote_average.desc", labelKey: "Highest rated" },
  { value: "primary_release_date.desc", labelKey: "Newest" },
  { value: "primary_release_date.asc", labelKey: "Oldest" },
] as const;

const LANGUAGE_OPTIONS = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "hi", name: "Hindi" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
] as const;

const COUNTRY_OPTIONS = [
  { code: "KR", name: "South Korea" },
  { code: "US", name: "United States" },
  { code: "JP", name: "Japan" },
  { code: "HK", name: "Hong Kong" },
  { code: "CN", name: "China" },
  { code: "FR", name: "France" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
] as const;

const CERTIFICATION_OPTIONS = ["G", "PG", "PG-13", "R", "NC-17"] as const;

export function DiscoverSection() {
  const { t } = useLingui();

  const search = useSearch({ from: "/_app/explore" });
  const navigate = useNavigate({ from: "/explore" });
  const {
    genreId,
    yearMin,
    yearMax,
    ratingMin,
    sortBy,
    language,
    originCountry,
    certification,
    accessType,
    platformId,
  } = search;
  const type = search.type ?? "movie";
  const selectedPlatformIds = search.platformIds ?? (platformId ? [platformId] : []);
  const providerCount = selectedPlatformIds.length;
  const hasFilters = Object.entries(search).some(
    ([key, value]) =>
      value !== undefined &&
      !(key === "type" && value === "movie") &&
      !(key === "sortBy" && value === "popularity.desc"),
  );

  function updateSearch(updates: Partial<DiscoverSearch>) {
    void navigate({
      search: (prev) => {
        const next = { ...prev, ...updates };
        for (const [key, value] of Object.entries(next)) {
          if (
            value === undefined ||
            value === "" ||
            (Array.isArray(value) && value.length === 0) ||
            (key === "type" && value === "movie") ||
            (key === "sortBy" && value === "popularity.desc")
          ) {
            delete (next as Record<string, unknown>)[key];
          }
        }
        return next;
      },
      replace: true,
      resetScroll: false,
    });
  }

  const { data: genreData } = useQuery(orpc.discover.genres.queryOptions({ input: { type } }));
  const { data: providerData } = useQuery(orpc.discover.platforms.queryOptions());

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isError, refetch } =
    useInfiniteQuery(
      orpc.discover.browse.infiniteOptions({
        input: (pageParam: number) => ({
          type,
          genreId,
          yearMin,
          yearMax,
          ratingMin,
          sortBy,
          language,
          originCountry,
          certification,
          accessType,
          platformIds: selectedPlatformIds,
          page: pageParam,
        }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) =>
          lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
        maxPages: 10,
      }),
    );

  const sentinelRef = useInfiniteScroll({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  });

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data?.pages]);

  const genres = genreData?.genres ?? [];
  const providerType = accessType === "paid" ? "paid" : accessType ? "free" : "all";
  const providers = (providerData?.platforms ?? []).filter(
    (provider) => providerType === "all" || provider.accessTypes?.includes(providerType),
  );

  const sortLabels: Record<string, string> = {
    "popularity.desc": t`Most popular`,
    "vote_average.desc": t`Highest rated`,
    "primary_release_date.desc": t`Newest`,
    "primary_release_date.asc": t`Oldest`,
  };

  const languageNames: Record<string, string> = {
    en: t`English`,
    es: t`Spanish`,
    fr: t`French`,
    de: t`German`,
    ja: t`Japanese`,
    ko: t`Korean`,
    zh: t`Chinese`,
    hi: t`Hindi`,
    it: t`Italian`,
    pt: t`Portuguese`,
  };

  const countryNames: Record<string, string> = {
    KR: t`South Korea`,
    US: t`United States`,
    JP: t`Japan`,
    HK: t`Hong Kong`,
    CN: t`China`,
    FR: t`France`,
    GB: t`United Kingdom`,
    IN: t`India`,
  };

  function handleDecadeChange(value: string | null) {
    if (!value) {
      updateSearch({ yearMin: undefined, yearMax: undefined });
      return;
    }
    const preset = DECADE_PRESETS.find((d) => String(d.min) === value);
    if (preset) {
      updateSearch({ yearMin: preset.min, yearMax: preset.max });
    }
  }

  function handleRatingChange(value: string | null) {
    if (!value) {
      updateSearch({ ratingMin: undefined });
      return;
    }
    updateSearch({ ratingMin: Number(value) });
  }

  function handleSortChange(value: string | null) {
    updateSearch({ sortBy: (value || undefined) as DiscoverSearch["sortBy"] });
  }

  function handleLanguageChange(value: string | null) {
    updateSearch({ language: value || undefined });
  }

  function handleCountryChange(value: string | null) {
    updateSearch({ originCountry: value || undefined });
  }

  function handleCertificationChange(value: string | null) {
    updateSearch({ certification: (value || undefined) as DiscoverSearch["certification"] });
  }

  function handleProviderChange(id: string, checked: boolean) {
    updateSearch({
      platformId: undefined,
      platformIds: checked
        ? [...new Set([...selectedPlatformIds, id])]
        : selectedPlatformIds.filter((selected) => selected !== id),
    });
  }

  function handleGenreChange(value: string | null) {
    if (!value) {
      updateSearch({ genreId: undefined });
      return;
    }
    updateSearch({ genreId: Number(value) });
  }

  return (
    <FeedSection title={t`Discover`} icon={<IconSearch className="text-primary size-5" />}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-2 sm:flex-1 sm:basis-96">
          {/* Type toggle: Movie | TV */}
          <ToggleGroup
            value={[type]}
            onValueChange={(values) => {
              const next = values.find((v) => v !== type);
              if (next === "movie" || next === "tv") {
                updateSearch({
                  type: next,
                  genreId: undefined,
                  platformId: undefined,
                  platformIds: undefined,
                  certification: undefined,
                });
              }
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="movie">{t`Movie`}</ToggleGroupItem>
            <ToggleGroupItem value="tv">{t`TV`}</ToggleGroupItem>
          </ToggleGroup>

          {/* Divider */}
          <div className="bg-border/30 mx-0.5 hidden h-5 w-px sm:block" />

          {/* Genre select */}
          <Select
            value={genreId != null ? String(genreId) : ""}
            onValueChange={handleGenreChange}
            modal={false}
            aria-label={t`Genre`}
          >
            <SelectTrigger
              size="sm"
              data-active={genreId != null ? "" : undefined}
              className="data-[active]:border-primary/40 data-[active]:text-foreground"
            >
              <SelectValue>
                {(value: string | null) => {
                  if (!value) return t`Genre`;
                  const genre = genres.find((g) => String(g.id) === value);
                  return genre?.name ?? t`Genre`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="p-1">
              <SelectItem value="">{t`All genres`}</SelectItem>
              {genres.map((genre) => (
                <SelectItem key={genre.id} value={String(genre.id)}>
                  {genre.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Year select (decade presets) */}
          <Select
            value={yearMin != null ? String(yearMin) : ""}
            onValueChange={handleDecadeChange}
            modal={false}
            aria-label={t`Decade`}
          >
            <SelectTrigger
              size="sm"
              data-active={yearMin != null ? "" : undefined}
              className="data-[active]:border-primary/40 data-[active]:text-foreground"
            >
              <SelectValue>
                {(value: string | null) => {
                  if (!value) return t`Year`;
                  const preset = DECADE_PRESETS.find((d) => String(d.min) === value);
                  if (preset?.min === 1900) return t`Pre-1970`;
                  return preset?.label ?? t`Year`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="p-1">
              <SelectItem value="">{t`Any year`}</SelectItem>
              {DECADE_PRESETS.map((d) => (
                <SelectItem key={d.min} value={String(d.min)}>
                  {d.min === 1900 ? t`Pre-1970` : d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* US movie content rating */}
          {type === "movie" && (
            <Select
              value={certification ?? ""}
              onValueChange={handleCertificationChange}
              modal={false}
              aria-label={t`Maximum US content rating`}
            >
              <SelectTrigger
                size="sm"
                data-active={certification ? "" : undefined}
                className="data-[active]:border-primary/40 data-[active]:text-foreground"
              >
                <SelectValue>
                  {(value: string | null) => (value ? t`Up to ${value}` : t`Content rating`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="p-1">
                <SelectItem value="">{t`Any content rating`}</SelectItem>
                {CERTIFICATION_OPTIONS.map((rating) => (
                  <SelectItem key={rating} value={rating}>
                    {t`Up to ${rating}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Rating select (minimum TMDB rating) */}
          <Select
            value={ratingMin != null ? String(ratingMin) : ""}
            onValueChange={handleRatingChange}
            modal={false}
            aria-label={t`Minimum TMDB score`}
          >
            <SelectTrigger
              size="sm"
              data-active={ratingMin != null ? "" : undefined}
              className="data-[active]:border-primary/40 data-[active]:text-foreground"
            >
              <SelectValue>
                {(value: string | null) => {
                  if (!value) return t`TMDB score`;
                  return `${value}+`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="p-1">
              <SelectItem value="">{t`Any TMDB score`}</SelectItem>
              {RATING_PRESETS.map((r) => (
                <SelectItem key={r.value} value={String(r.value)}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Language select */}
          <Select
            value={language ?? ""}
            onValueChange={handleLanguageChange}
            modal={false}
            aria-label={t`Language`}
          >
            <SelectTrigger
              size="sm"
              data-active={language ? "" : undefined}
              className="data-[active]:border-primary/40 data-[active]:text-foreground"
            >
              <SelectValue>
                {(value: string | null) => {
                  if (!value) return t`Language`;
                  return languageNames[value] ?? t`Language`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="p-1">
              <SelectItem value="">{t`Any language`}</SelectItem>
              {LANGUAGE_OPTIONS.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {languageNames[lang.code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Country of origin */}
          <Select
            value={originCountry ?? ""}
            onValueChange={handleCountryChange}
            modal={false}
            aria-label={t`Country of origin`}
          >
            <SelectTrigger
              size="sm"
              data-active={originCountry ? "" : undefined}
              className="data-[active]:border-primary/40 data-[active]:text-foreground"
            >
              <SelectValue>
                {(value: string | null) => {
                  if (!value) return t`Country`;
                  return countryNames[value] ?? t`Country`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="p-1">
              <SelectItem value="">{t`Any country`}</SelectItem>
              {COUNTRY_OPTIONS.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {countryNames[country.code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Provider category controls both offers and the linked provider list. */}
          <Select
            value={providerType}
            onValueChange={(value) => {
              updateSearch({
                platformId: undefined,
                platformIds: undefined,
                accessType:
                  value === "free" ? "free_or_ads" : value === "paid" ? "paid" : undefined,
              });
            }}
            modal={false}
            aria-label={t`Provider type`}
          >
            <SelectTrigger size="sm">
              <SelectValue>
                {(value: string | null) =>
                  value === "free"
                    ? t`Free providers`
                    : value === "paid"
                      ? t`Paid providers`
                      : t`All provider types`
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="p-1">
              <SelectItem value="all">{t`All`}</SelectItem>
              <SelectItem value="free">{t`Free`}</SelectItem>
              <SelectItem value="paid">{t`Paid`}</SelectItem>
            </SelectContent>
          </Select>

          {/* Match any checked provider. */}
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  data-slot="select-trigger"
                  data-size="sm"
                  aria-label={t`Streaming providers`}
                  data-active={selectedPlatformIds.length > 0 ? "" : undefined}
                  className={cn(
                    selectTriggerClassName,
                    "data-[active]:border-primary/40 data-[active]:text-foreground",
                  )}
                >
                  <span data-slot="select-value">
                    {selectedPlatformIds.length === 0
                      ? t`All providers`
                      : selectedPlatformIds.length === 1
                        ? (providerData?.platforms.find((p) => p.id === selectedPlatformIds[0])
                            ?.name ?? t`Provider`)
                        : t`Providers (${providerCount})`}
                  </span>
                  <IconSelector
                    aria-hidden={true}
                    className="text-muted-foreground pointer-events-none size-3.5"
                  />
                </button>
              }
            />
            <PopoverContent align="start" className="w-64 gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={selectedPlatformIds.length === 0}
                onClick={() => updateSearch({ platformId: undefined, platformIds: undefined })}
              >
                {t`All providers`}
              </Button>
              <div className="max-h-72 overflow-y-auto">
                {providers
                  .filter((p) => p.tmdbProviderIds.length > 0)
                  .map((platform) => (
                    <label
                      key={platform.id}
                      className="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm"
                    >
                      <Checkbox
                        checked={selectedPlatformIds.includes(platform.id)}
                        onCheckedChange={(checked) => handleProviderChange(platform.id, checked)}
                      />
                      {platform.name}
                    </label>
                  ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
          <DiscoveryPresets
            filters={search}
            onLoad={(filters) => {
              void navigate({ search: filters, replace: true, resetScroll: false });
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasFilters}
            onClick={() => {
              void navigate({ search: {}, replace: true, resetScroll: false });
            }}
          >
            <IconFilterOff aria-hidden={true} />
            {t`Reset filters`}
          </Button>
          {/* Sort select */}
          <Select
            value={sortBy ?? ""}
            onValueChange={handleSortChange}
            modal={false}
            aria-label={t`Sort`}
          >
            <SelectTrigger
              size="sm"
              data-active={sortBy ? "" : undefined}
              className="data-[active]:border-primary/40 data-[active]:text-foreground"
            >
              <SelectValue>
                {(value: string | null) => {
                  if (!value) return t`Sort`;
                  return sortLabels[value] ?? t`Sort`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="p-1">
              <SelectItem value="">{t`Default`}</SelectItem>
              {SORT_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {sortLabels[s.value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">{t`US availability checked per title. Free includes ad-supported offers; library services may require a library card.`}</p>

      {/* Results */}
      {isPending ? (
        <div className="flex items-center justify-center py-12">
          <IconLoader className="text-muted-foreground size-6 animate-spin" />
        </div>
      ) : isError ? (
        <div className="space-y-3 py-12 text-center">
          <p className="text-muted-foreground text-sm">{t`Unable to check current availability. Try again.`}</p>
          <Button variant="outline" onClick={() => void refetch()}>{t`Retry`}</Button>
        </div>
      ) : items.length === 0 ? (
        <div className="space-y-3 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            {hasNextPage
              ? t`No verified matches on these pages. Check more results or broaden your filters.`
              : t`No titles match these filters. Broaden your filters or reset them to start again.`}
          </p>
          {hasNextPage && (
            <Button
              variant="outline"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >{t`Check more results`}</Button>
          )}
          <Button
            variant="ghost"
            onClick={() => void navigate({ search: {}, replace: true, resetScroll: false })}
          >{t`Reset filters`}</Button>
        </div>
      ) : (
        <>
          <TitleGrid items={items} wide />
          <div ref={sentinelRef} />
          {isFetchingNextPage && (
            <div className="flex items-center justify-center py-4">
              <IconLoader className="text-muted-foreground size-5 animate-spin" />
            </div>
          )}
        </>
      )}
    </FeedSection>
  );
}
