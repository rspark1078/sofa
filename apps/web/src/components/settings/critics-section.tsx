import { Trans, useLingui } from "@lingui/react/macro";
import { IconCheck, IconChevronDown, IconMessageStar } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/lib/orpc/client";
import { AddRecommendationCreatorInput, CriticPreferences } from "@sofa/api/schemas";
import { formatDate } from "@sofa/i18n/format";

import criticAvatars from "./critic-avatars.json";

export function CriticsSection({ isAdmin = false }: { isAdmin?: boolean }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const add = useMutation(
    orpc.account.addCritic.mutationOptions({
      onSuccess: () => {
        setName("");
        setChannelUrl("");
        void queryClient.invalidateQueries({ queryKey: orpc.account.criticPreferences.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.discover.recommendations.key() });
        toast.success(t`Critic added`);
      },
      onError: () =>
        toast.error(
          t`Unable to add critic. The channel may already exist or the catalog may be full.`,
        ),
    }),
  );
  const options = orpc.account.criticPreferences.queryOptions();
  const { data, isPending, isError, refetch } = useQuery(options);
  const mutation = useMutation(
    orpc.account.updateCriticPreferences.mutationOptions({
      onSuccess: (preferences) => {
        queryClient.setQueryData(options.queryKey, (previous: typeof data) =>
          previous ? { ...previous, preferences } : previous,
        );
        void queryClient.invalidateQueries({ queryKey: orpc.discover.recommendations.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.account.creatorRefreshStatus.key() });
      },
      onError: () => toast.error(t`Failed to save critic preferences`),
    }),
  );
  const statusOptions = orpc.account.creatorRefreshStatus.queryOptions();
  const { data: status } = useQuery({ ...statusOptions, refetchInterval: 60_000 });
  const refresh = useMutation(
    orpc.account.refreshCreators.mutationOptions({
      onSuccess: (result) => {
        queryClient.setQueryData(statusOptions.queryKey, result);
        void queryClient.invalidateQueries({ queryKey: orpc.discover.recommendations.key() });
        if (result.failed)
          toast.error(
            t`Some channels or recommendation checks could not be completed. Try again later.`,
          );
      },
      onError: () => toast.error(t`Unable to check critic channels`),
    }),
  );
  const videosChecked = status?.videosChecked ?? 0;
  const picksAdded = status?.picksAdded ?? 0;
  const lastCheckedLabel = status?.lastCheckedAt
    ? formatDate(status.lastCheckedAt, { hour: "numeric", minute: "2-digit" })
    : null;
  const disabled = isPending || mutation.isPending || refresh.isPending || !data;
  const selected =
    data?.preferences.creatorIds ?? data?.creators.map((creator) => creator.id) ?? [];
  const selectedCount = selected.length;
  const frequencies = [
    { value: "manual", label: t`Manual` },
    { value: "hourly", label: t`Hourly` },
    { value: "daily", label: t`Daily` },
    { value: "weekly", label: t`Weekly` },
  ];
  function save(preferences: z.infer<typeof CriticPreferences>) {
    mutation.mutate(preferences);
  }
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardContent className={open ? "pb-4" : ""}>
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <IconMessageStar aria-hidden="true" className="text-primary size-4" />
              </div>
              <div className="text-start">
                <CardTitle>
                  <Trans>Critics and creators</Trans>
                </CardTitle>
                <CardDescription>
                  {data
                    ? t`${selectedCount} selected`
                    : t`Choose whose movie picks appear in your recommendations`}
                </CardDescription>
              </div>
            </div>
            <IconChevronDown
              aria-hidden="true"
              className={`text-muted-foreground size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
        </CardContent>
        <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
          <CardContent className="border-border/30 space-y-4 border-t pt-4">
            <p className="text-muted-foreground text-sm">
              <Trans>
                Choose whose movie picks appear in your recommendations. Your watch-history
                recommendations remain available.
              </Trans>
            </p>
            {isError ? (
              <button
                type="button"
                className="text-primary text-sm underline"
                onClick={() => void refetch()}
              >
                <Trans>Unable to load critics. Retry</Trans>
              </button>
            ) : (
              <>
                <label htmlFor="critic-follow-all" className="flex items-center gap-3 text-sm">
                  <Checkbox
                    id="critic-follow-all"
                    checked={data?.preferences.creatorIds === null}
                    disabled={disabled}
                    onCheckedChange={(checked) => {
                      if (data)
                        save({ ...data.preferences, creatorIds: checked ? null : selected });
                    }}
                  />
                  <Trans>Follow all critics, including new additions</Trans>
                </label>
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
                  {data?.creators.map((creator) => {
                    const isSelected = selected.includes(creator.id);
                    const creatorName = creator.name;
                    return (
                      <div key={creator.id} className="flex min-w-0 flex-col gap-2">
                        <button
                          type="button"
                          disabled={disabled}
                          aria-label={t`Toggle ${creatorName}`}
                          aria-pressed={isSelected}
                          onClick={() => {
                            if (data)
                              save({
                                ...data.preferences,
                                creatorIds: isSelected
                                  ? selected.filter((id) => id !== creator.id)
                                  : [...selected, creator.id],
                              });
                          }}
                          className={`group focus-visible:ring-primary relative flex h-full min-h-28 flex-col items-center gap-2 rounded-xl border p-3 focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60 motion-safe:transition-colors motion-safe:duration-150 ${isSelected ? "border-primary/50 bg-primary/8" : "border-border/50 hover:border-primary/30 hover:bg-primary/5"}`}
                        >
                          {isSelected && (
                            <span
                              aria-hidden="true"
                              className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full"
                            >
                              <IconCheck className="size-2.5" strokeWidth={3} />
                            </span>
                          )}
                          <CriticAvatar name={creator.name} channelUrl={creator.channelUrl} />
                          <span className="text-muted-foreground w-full text-center text-[11px] leading-tight break-words">
                            {creator.name}
                          </span>
                        </button>
                        <a
                          href={creator.channelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary text-center text-xs hover:underline"
                          aria-label={t`Visit ${creatorName}'s channel`}
                        >
                          <Trans>Visit channel</Trans>
                        </a>
                      </div>
                    );
                  })}
                </div>
                {isAdmin && (
                  <form
                    className="space-y-3 border-t pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const parsed = AddRecommendationCreatorInput.safeParse({ name, channelUrl });
                      if (!parsed.success) {
                        toast.error(
                          t`Enter a name and a YouTube channel URL containing its channel ID.`,
                        );
                        return;
                      }
                      add.mutate(parsed.data);
                    }}
                  >
                    <p className="text-sm font-medium">
                      <Trans>Add a critic</Trans>
                    </p>
                    <label className="block space-y-1 text-sm" htmlFor="new-critic-name">
                      <span>
                        <Trans>Critic name</Trans>
                      </span>
                      <Input
                        id="new-critic-name"
                        value={name}
                        maxLength={100}
                        required
                        disabled={add.isPending}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <label className="block space-y-1 text-sm" htmlFor="new-critic-channel">
                      <span>
                        <Trans>YouTube channel URL</Trans>
                      </span>
                      <Input
                        id="new-critic-channel"
                        type="url"
                        value={channelUrl}
                        required
                        disabled={add.isPending}
                        placeholder="https://www.youtube.com/channel/UC…"
                        onChange={(event) => setChannelUrl(event.target.value)}
                      />
                    </label>
                    <p className="text-muted-foreground text-xs">
                      <Trans>
                        Use the channel ID URL, not an @handle or video link. On YouTube, open the
                        channel description, choose Share channel, then Copy channel ID.
                      </Trans>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      <Trans>
                        Added to the shared catalog. Users following all critics will include this
                        channel. Adding a channel does not add verified movie picks or guarantee its
                        video feed is available.
                      </Trans>
                    </p>
                    <Button type="submit" disabled={disabled || add.isPending}>
                      {add.isPending ? t`Adding critic…` : t`Add critic`}
                    </Button>
                  </form>
                )}
                <div className="space-y-2">
                  <p id="critic-refresh-label" className="text-sm font-medium">
                    <Trans>Check for new videos</Trans>
                  </p>
                  <Select
                    value={data?.preferences.refreshFrequency ?? "daily"}
                    disabled={disabled}
                    onValueChange={(value) => {
                      if (data) {
                        const parsed = CriticPreferences.shape.refreshFrequency.safeParse(value);
                        if (parsed.success)
                          save({ ...data.preferences, refreshFrequency: parsed.data });
                      }
                    }}
                  >
                    <SelectTrigger aria-labelledby="critic-refresh-label">
                      <SelectValue>
                        {
                          frequencies.find(
                            (frequency) =>
                              frequency.value === (data?.preferences.refreshFrequency ?? "daily"),
                          )?.label
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {frequencies.map((frequency) => (
                        <SelectItem key={frequency.value} value={frequency.value}>
                          {frequency.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    <Trans>
                      Checks your selected channels while the server is running. Clear
                      recommendations with exact movie matches are added automatically. Other videos
                      need review.
                    </Trans>
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={disabled || refresh.isPending || selected.length === 0}
                  onClick={() => refresh.mutate(undefined)}
                >
                  {refresh.isPending ? t`Checking channels…` : t`Check now`}
                </Button>
                <p className="text-muted-foreground text-xs">
                  {status?.lastCheckedAt
                    ? t`Last successful check: ${lastCheckedLabel}`
                    : t`Channels have not been checked yet.`}
                </p>
                {status && (
                  <p className="text-muted-foreground text-xs">
                    <Trans>
                      Last refresh: {videosChecked} videos checked, {picksAdded} movie picks added.
                    </Trans>
                  </p>
                )}
                {status?.failed && (
                  <output className="text-destructive text-sm">
                    <Trans>
                      The last check could not complete every channel or recommendation check.
                      Existing recommendations are preserved.
                    </Trans>
                  </output>
                )}
                {!!status?.videos.length && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      <Trans>Recent videos and recommendation checks</Trans>
                    </p>
                    {status.videos.map((video) => (
                      <div key={video.creatorSlug + video.videoId} className="text-sm">
                        <a
                          href={video.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {video.videoTitle}
                        </a>
                        <p className="text-muted-foreground text-xs">
                          {video.creatorName} · {formatDate(video.publishedAt)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {!video.pickCheck
                            ? t`Awaiting recommendation check`
                            : video.pickCheck.state === "added"
                              ? t`Verified recommendations saved`
                              : video.pickCheck.state === "failed"
                                ? t`Verification unavailable; retry required`
                                : t`Recommendation review required`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function CriticAvatar({ name, channelUrl }: { name: string; channelUrl: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const channelId = channelUrl.match(/\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1] ?? "";
  const source = (criticAvatars as Record<string, string>)[channelId];
  return (
    <span
      aria-hidden="true"
      className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-xs font-medium"
    >
      {source && failedSource !== source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-10 object-cover"
          onError={() => setFailedSource(source)}
        />
      ) : (
        name
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
      )}
    </span>
  );
}
