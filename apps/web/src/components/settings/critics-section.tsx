import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/lib/orpc/client";
import { CriticPreferences } from "@sofa/api/schemas";
import { formatDate } from "@sofa/i18n/format";

export function CriticsSection() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
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
        if (result.failed)
          toast.error(t`Some critic channels could not be checked. Try again later.`);
      },
      onError: () => toast.error(t`Unable to check critic channels`),
    }),
  );
  const lastCheckedLabel = status?.lastCheckedAt
    ? formatDate(status.lastCheckedAt, { hour: "numeric", minute: "2-digit" })
    : null;
  const disabled = isPending || mutation.isPending || refresh.isPending || !data;
  const selected =
    data?.preferences.creatorIds ?? data?.creators.map((creator) => creator.id) ?? [];
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
      <CardContent className="space-y-4">
        <div>
          <CardTitle>
            <Trans>Critics and creators</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Choose whose movie picks appear in your recommendations. Your watch-history
              recommendations remain available.
            </Trans>
          </CardDescription>
        </div>
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
                  if (data) save({ ...data.preferences, creatorIds: checked ? null : selected });
                }}
              />
              <Trans>Follow all critics, including new additions</Trans>
            </label>
            {data?.creators.map((creator) => (
              <div key={creator.id} className="flex items-center justify-between gap-4">
                <label htmlFor={`critic-${creator.id}`} className="flex items-center gap-3 text-sm">
                  <Checkbox
                    id={`critic-${creator.id}`}
                    checked={selected.includes(creator.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) => {
                      if (data)
                        save({
                          ...data.preferences,
                          creatorIds: checked
                            ? [...selected, creator.id]
                            : selected.filter((id) => id !== creator.id),
                        });
                    }}
                  />
                  {creator.name}
                </label>
                <a
                  href={creator.channelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary text-xs hover:underline"
                  aria-label={creator.name}
                >
                  <Trans>Visit channel</Trans>
                </a>
              </div>
            ))}
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
                  Checks your selected channels while the server is running. New videos need
                  verified recommendation evidence before movies are added to the feed.
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
            {status?.failed && (
              <output className="text-destructive text-sm">
                <Trans>
                  The last check could not reach every selected channel. Existing recommendations
                  are preserved.
                </Trans>
              </output>
            )}
            {!!status?.videos.length && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  <Trans>Recent videos — recommendation review required</Trans>
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
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
